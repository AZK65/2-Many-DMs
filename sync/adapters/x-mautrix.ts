import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Adapter, AdapterStatus, InboundMessage, OutboundMedia, OutboundSendContext, SentMessage } from "./types";
import { isXChatPin, type XUnlockState } from "../../src/lib/x-unlock-state";
import { MautrixError, MautrixProcess, type MautrixRPC, type MautrixEvent } from "../x-mautrix-process";
import { xBrowserConversationId, xMautrixConversationId } from "../x-mautrix-pilot";
import { saveMedia, extFromMime } from "../media";

type Job = { cursor: string; recent: boolean; retryAt?: number; attempts?: number; lastMessageAt?: number };
type InboxResult = { cursor?: { cursor_id?: string; graph_snapshot_id?: string; pull_finished?: boolean }; maxSequence?: string; messageCursor?: { max_local_sequence_id?: string; pull_finished?: boolean } };
type HistoryResult = { cursor: string; hasMore: boolean; count: number };
type Conversation = { conversation_id: string; group_metadata?: { group_name?: string }; participants_results?: { rest_id?: string; result?: { rest_id?: string; core?: { name?: string; screen_name?: string } } }[] };

export class XMautrixAdapter implements Adapter {
  platform = "x" as const;
  private rpc: MautrixRPC;
  private onMessage?: (message: InboundMessage) => Promise<void>;
  private state: AdapterStatus["state"] = "starting";
  private unlockState: XUnlockState = { state: "required", detail: "Enter your X Chat PIN to unlock messages.", updatedAt: Date.now() };
  private userId = "";
  private conversations = new Map<string, Conversation>();
  private jobs = new Map<string, Job>();
  private completed = new Set<string>();
  private savedContacts = new Map<string, { name: string; handle: string; isGroup: boolean; inboxCategory: "general" | "spam" }>();
  private mediaQueue = new Map<string, () => Promise<void>>();
  private mediaRunning = 0;
  private urgent = new Set<string>();
  private requestedHistory = new Set<string>();
  private preferHistory = true;
  private pagesFetched = 0;
  private lastProgressAt = 0;
  private nextHistoryAt = 0;
  private timerAt = 0;
  private lastInboxSequence = "";
  private checkedAt = 0;
  private lastMessageAt = 0;
  private retryAt = 0;
  private rateLimitLevel = 0;
  private inboxBusy = false;
  private inboxRetryAt = 0;
  private historyBusy = false;
  private sendCount = 0;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private inboxTimer?: NodeJS.Timeout;
  private checkpoint: string;
  constructor(private options: { accountId: string; session?: { authToken: string; ct0: string }; onFailure?: () => void;
    rpcFactory?: (event: (event: MautrixEvent) => Promise<void>, exit: () => void) => MautrixRPC; checkpoint?: string }) {
    this.checkpoint = options.checkpoint || path.join(process.env.DATA_DIR || process.cwd(), ".local/x-mautrix", `${options.accountId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    const exit = () => { this.state = "disconnected"; if (!this.stopped) options.onFailure?.(); };
    this.rpc = options.rpcFactory?.(event => this.receive(event), exit) || new MautrixProcess(event => this.receive(event), exit);
  }
  private save() {
    fs.mkdirSync(path.dirname(this.checkpoint), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.checkpoint + ".tmp", JSON.stringify({ version: 1, jobs: [...this.jobs], completed: [...this.completed], continuation: this.inboxContinuation, sequence: this.lastInboxSequence, pagesFetched: this.pagesFetched, lastProgressAt: this.lastProgressAt, retryAt: this.retryAt, rateLimitLevel: this.rateLimitLevel }), { mode: 0o600 });
    fs.renameSync(this.checkpoint + ".tmp", this.checkpoint);
  }
  async start(onMessage: (message: InboundMessage) => Promise<void>) {
    this.onMessage = onMessage;
    try { const saved = JSON.parse(fs.readFileSync(this.checkpoint, "utf8")); if (saved.version === 1) { this.jobs = new Map(saved.jobs); this.completed = new Set(saved.completed || []); this.inboxContinuation = saved.continuation; this.lastInboxSequence = saved.sequence || ""; this.pagesFetched = saved.pagesFetched || 0; this.lastProgressAt = saved.lastProgressAt || 0; this.retryAt = Number(saved.retryAt) || 0; this.rateLimitLevel = Math.max(0, Math.min(5, Number(saved.rateLimitLevel) || 0)); } } catch {}
    let cookies: Record<string, string>;
    if (this.options.session) cookies = { auth_token: this.options.session.authToken, ct0: this.options.session.ct0 };
    else if (process.env.X_AUTH_TOKEN && process.env.X_CT0) cookies = { auth_token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 };
    else {
      const values = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".x_auth/cookies.json"), "utf8")) as { name: string; value: string }[];
      cookies = Object.fromEntries(values.map(value => [value.name, value.value]));
    }
    const profile = await this.rpc.request<{ userId: string }>("start", { cookies });
    if (!/^\d+$/.test(profile.userId)) throw new MautrixError("missing_account_identity", "start");
    this.userId = profile.userId;
    if (!this.options.rpcFactory) {
      const { prisma } = await import("../store");
      const stored = await prisma.conversation.findMany({ where: { platform: "x", accountId: this.options.accountId }, select: { externalId: true, lastMessageAt: true, inboxCategory: true, contact: { select: { name: true, handle: true, isGroup: true } } } });
      for (const c of stored) if (c.externalId) {
        this.savedContacts.set(c.externalId, { ...c.contact, handle: c.contact.handle || c.contact.name, inboxCategory: c.inboxCategory === "spam" ? "spam" : "general" });
        const job = this.jobs.get(c.externalId);
        if (job) job.lastMessageAt = Math.max(job.lastMessageAt || 0, c.lastMessageAt.getTime());
      }
    }
  }
  async unlockChat(pin: string): Promise<XUnlockState> {
    if (!isXChatPin(pin)) throw new Error("Enter your 4-digit X Chat PIN.");
    if (this.unlockState.state === "verifying" || this.unlockState.state === "unlocked") return { ...this.unlockState, pinVerified: false };
    this.unlockState = { state: "verifying", detail: "Checking your PIN and live connection with X…", startedAt: Date.now(), updatedAt: Date.now() };
    try {
      await this.rpc.request("unlock", { pin });
      this.state = "ready";
      // Verify one inbox page, then restore older pages in the background.
      await this.refreshInbox();
      this.unlockState = { state: "unlocked", detail: "Connected and ready. Older history restores in the background.", updatedAt: Date.now(), pinVerified: true };
      this.inboxTimer = setInterval(() => void this.refreshInbox().catch(() => {}), 60_000);
      this.scheduleHistory();
    } catch (error) {
      this.state = "disconnected";
      const code = error instanceof MautrixError ? error.code : "connector_error";
      this.unlockState = { state: code === "incorrect_pin" ? "rejected" : "error", updatedAt: Date.now(), detail: code === "incorrect_pin" ? "X rejected that PIN. No automatic retry was made." : code === "pin_locked" ? "X has locked PIN recovery. Open X before trying again." : "X could not finish verifying this connection. Your PIN was not retried automatically." };
    }
    return this.unlockState;
  }
  private async receive(event: MautrixEvent) {
    if (this.stopped) throw new Error("Connector stopped");
    if (event.event === "connection") { this.state = event.ready ? "ready" : "starting"; return; }
    if (event.event === "conversation") {
      const conversation = event.conversation as Conversation;
      const id = xBrowserConversationId(conversation.conversation_id);
      if (!id) throw new Error("Missing conversation identity");
      this.conversations.set(id, conversation);
      if (!this.jobs.has(id) && !this.completed.has(id)) this.jobs.set(id, { cursor: "", recent: true });
      this.scheduleHistory();
      return;
    }
    if (event.event !== "message") return;
    const m = event.message;
    const chat = xBrowserConversationId(m.conversation_id || "");
    const id = event.nativeId as string;
    const timestamp = Number(m.time || m.message_data?.time);
    if (!chat || !id || !Number.isFinite(timestamp) || timestamp <= 0) throw new Error("Invalid native message identity or time");
    const job = this.jobs.get(chat);
    if (job) job.lastMessageAt = Math.max(job.lastMessageAt || 0, timestamp);
    let conversation = this.conversations.get(chat);
    const saved = this.savedContacts.get(chat);
    if (!conversation && !saved) {
      conversation = await this.rpc.request<Conversation>("conversation", { conversation: xMautrixConversationId(chat) }, 8_000);
      this.conversations.set(chat, conversation);
    }
    const peer = conversation?.participants_results?.find(p => (p.rest_id || p.result?.rest_id) !== this.userId)?.result;
    const isGroup = Boolean(conversation?.group_metadata || saved?.isGroup || /^g/.test(chat));
    const name = saved?.name || conversation?.group_metadata?.group_name || peer?.core?.name || peer?.core?.screen_name || "X user";
    const attachment = event.attachments?.[0] || m.message_data?.attachment;
    const info = attachment?.photo || attachment?.video || attachment?.animated_gif || attachment?.file || attachment?.media;
    const mediaType = attachment?.photo ? "image" : info?.audio_only ? "audio" : attachment?.video || attachment?.animated_gif ? "video" : "file";
    const message: InboundMessage = { platform: "x", chatExternalId: chat, messageExternalId: `x:${id}`,
      direction: m.message_data?.sender_id === this.userId ? "out" : "in", body: m.message_data?.text || "",
      timestamp: new Date(timestamp), timestampVerified: true, historical: event.historical === true,
      inboxCategory: m.trusted === undefined ? saved?.inboxCategory : m.trusted === false ? "spam" : "general", isGroup,
      contact: { externalKey: `x:${chat}`, name, handle: saved?.handle || peer?.core?.screen_name || name },
      ...(info ? { media: { type: mediaType, url: null, name: info.filename, isGif: Boolean(attachment?.animated_gif) } } : {}),
      ...(m.message_data?.reply_data?.id ? { replyToExternalKey: `x:${m.message_data.reply_data.id}`, replyPreview: m.message_data.reply_data.text } : {}),
    };
    await this.onMessage!(message);
    // Attachments must never hold up live-text acknowledgement or a send.
    if (info?.media_hash_key && !this.mediaQueue.has(id) && this.mediaQueue.size < 100) {
      this.mediaQueue.set(id, async () => {
        const result = await this.rpc.request<{ data: string; mime: string }>("media", { conversation: xMautrixConversationId(chat), mediaHash: info.media_hash_key, keyVersion: m.conversation_key_version || m.message_data?.conversation_key_version });
        if (this.stopped) return;
        const bytes = Buffer.from(result.data, "base64");
        if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error("Invalid attachment size");
        const url = saveMedia(`x_${this.options.accountId}_${id}`, extFromMime(result.mime), bytes);
        await this.onMessage!({ ...message, historical: true, media: { ...message.media!, url } });
      });
      this.drainMedia();
    }
    this.lastMessageAt = Date.now();
  }
  private drainMedia() {
    if (this.stopped || this.mediaRunning >= 2) return;
    const next = this.mediaQueue.entries().next().value;
    if (!next) return;
    const [id, task] = next;
    this.mediaQueue.delete(id); this.mediaRunning++;
    void task().catch(() => {}).finally(() => { this.mediaRunning--; this.drainMedia(); });
  }
  private async refreshInbox() {
    if (this.inboxBusy || this.stopped || Date.now() < this.retryAt) return;
    this.inboxBusy = true;
    try {
      // Always check the current inbox on unlock/reconnect. Older inbox pages
      // have a separate continuation and must not hide chats received offline.
      const previous = this.inboxContinuation;
      const result = await this.rpc.request<InboxResult>("inbox", { cursor: this.lastInboxSequence });
      // Only advance a completely ingested page. Deep history never controls
      // the live transport or this incremental recovery checkpoint.
      if (!previous) {
        this.inboxContinuation = this.continuation(result);
        if (!this.inboxContinuation) this.lastInboxSequence = result.messageCursor?.max_local_sequence_id || result.maxSequence || this.lastInboxSequence;
      }
      this.checkedAt = Date.now(); this.save(); this.scheduleHistory();
    } catch (error) { if (error instanceof MautrixError && error.code === "rate_limited") this.deferRateLimit(); throw error; }
    finally { this.inboxBusy = false; this.scheduleHistory(); }
  }
  private inboxContinuation?: InboxResult;
  private deferRateLimit() {
    // Upstream does not expose a reset deadline. Back off progressively rather
    // than treating a one-minute retry as X's promised quota reset.
    this.rateLimitLevel = Math.min(5, this.rateLimitLevel + 1);
    this.retryAt = Math.max(this.retryAt, Date.now() + Math.min(15 * 60_000, 60_000 * 2 ** (this.rateLimitLevel - 1)));
    this.save();
  }
  private continuation(result: InboxResult): InboxResult | undefined {
    return (result.cursor?.cursor_id && result.cursor.pull_finished !== true) || result.messageCursor?.pull_finished === false ? result : undefined;
  }
  private scheduleHistory() {
    if (this.stopped || this.state !== "ready" || this.historyBusy || this.sendCount) return;
    const now = Date.now();
    const availableAt = Math.min(this.urgent.size ? now : Infinity,
      this.inboxContinuation && !this.inboxBusy ? Math.max(now, this.inboxRetryAt) : Infinity,
      ...[...this.jobs.values()].map(job => Math.max(now, job.retryAt || 0)));
    if (!Number.isFinite(availableAt)) return;
    // Recent/explicit requests take priority. Bulk history is paced separately,
    // with longer persistent cooldowns when X refuses requests.
    const due = Math.max(availableAt, this.nextHistoryAt, this.retryAt);
    if (this.timer && this.timerAt <= due) return;
    clearTimeout(this.timer);
    this.timerAt = due;
    this.timer = setTimeout(() => { this.timer = undefined; void this.restoreNext().catch(() => {}).finally(() => this.scheduleHistory()); }, Math.max(0, due - now));
  }
  /** One bounded historical page per turn; sends and socket events never await it. */
  async restoreNext() {
    if (this.historyBusy || this.sendCount || this.stopped || this.state !== "ready" || Date.now() < this.retryAt) return;
    this.historyBusy = true;
    this.nextHistoryAt = Date.now() + 3000;
    let active: [string, Job] | undefined;
    let urgent: string | undefined;
    try {
      urgent = this.urgent.values().next().value;
      const eligible = [...this.jobs].filter(([, job]) => (job.retryAt || 0) <= Date.now());
      const requested = eligible.find(([id]) => this.requestedHistory.has(id));
      const recent = eligible.filter(([, job]) => job.recent).sort((a, b) => (b[1].lastMessageAt || 0) - (a[1].lastMessageAt || 0))[0];
      this.nextHistoryAt = Date.now() + (this.rateLimitLevel ? Math.min(15_000, 3000 * (this.rateLimitLevel + 1)) : urgent || requested || recent ? 500 : 3000);
      if (!urgent && !requested && !recent && this.inboxContinuation && !this.inboxBusy && Date.now() >= this.inboxRetryAt && (!this.preferHistory || !eligible.length)) {
        this.inboxBusy = true;
        const last = this.inboxContinuation;
        let result: InboxResult;
        try { result = await this.rpc.request<InboxResult>("inbox", last.cursor?.cursor_id ? { inboxCursor: { cursor_id: last.cursor.cursor_id, graph_snapshot_id: last.cursor.graph_snapshot_id } } : { cursor: last.messageCursor?.max_local_sequence_id }); }
        finally { this.inboxBusy = false; }
        this.inboxContinuation = this.continuation(result);
        if (this.inboxContinuation && JSON.stringify(this.inboxContinuation) === JSON.stringify(last)) throw new Error("X inbox cursor did not advance");
        if (!this.inboxContinuation) this.lastInboxSequence = result.messageCursor?.max_local_sequence_id || result.maxSequence || this.lastInboxSequence;
        this.inboxRetryAt = 0;
        this.preferHistory = true;
      } else {
        active = urgent ? [urgent, { cursor: "", recent: true }] : requested || recent || eligible[0];
        if (!active) return;
        const [id, job] = active;
        const result = await this.rpc.request<HistoryResult>("history", { conversation: xMautrixConversationId(id), cursor: job.cursor });
        if (result.hasMore && (!result.cursor || result.cursor === job.cursor)) throw new Error("X history cursor did not advance");
        this.pagesFetched++;
        this.lastProgressAt = Date.now();
        if (urgent) this.urgent.delete(urgent);
        else {
          this.requestedHistory.delete(id);
          // Rotate successful older pages so one long chat cannot monopolize
          // restoration. Discover older chats between deeper history pages.
          this.jobs.delete(id);
          if (result.hasMore) this.jobs.set(id, { cursor: result.cursor, recent: false, lastMessageAt: job.lastMessageAt });
          else this.completed.add(id);
          if (!job.recent) this.preferHistory = false;
        }
      }
      this.save();
    } catch (error) {
      if (urgent) this.urgent.delete(urgent);
      else if (active) { const [id, job] = active; this.requestedHistory.delete(id); this.jobs.set(id, { ...job, attempts: (job.attempts || 0) + 1, retryAt: Date.now() + 60_000 }); }
      else this.inboxRetryAt = Date.now() + 60_000;
      if (error instanceof MautrixError && error.code === "rate_limited") this.deferRateLimit();
      this.save();
    } finally { this.historyBusy = false; }
  }
  refreshRecent(chat: string) { this.urgent.add(chat); this.scheduleHistory(); }
  async requestHistory(chat: string) {
    // Move this chat's existing older-history job to the front, preserving
    // its cursor. Opening a chat uses refreshRecent's separate latest window.
    const job = this.jobs.get(chat);
    if (job) { this.requestedHistory.add(chat); this.scheduleHistory(); }
    else if (!this.completed.has(chat)) { this.jobs.set(chat, { cursor: "", recent: true }); this.scheduleHistory(); }
  }
  async send(chat: string, body: string, media?: OutboundMedia, mentions?: string[], reply?: string, _context?: OutboundSendContext): Promise<SentMessage> {
    if (media || mentions?.length || reply) throw new MautrixError("unsupported", "prepare");
    if (this.state !== "ready") throw new MautrixError("not_ready", "prepare");
    this.sendCount++;
    try {
      const result = await this.rpc.request<{ messageId: string; timestamp: string }>("send", { conversation: xMautrixConversationId(chat), text: body, messageId: randomUUID() });
      const timestamp = new Date(Number(result.timestamp));
      if (!result.messageId || !Number.isFinite(timestamp.getTime()) || timestamp.getTime() <= 0) throw new MautrixError("missing_receipt", "send", true);
      return { messageExternalId: `x:${result.messageId}`, timestamp: timestamp.toISOString() };
    } finally { this.sendCount--; this.scheduleHistory(); }
  }
  getStatus(): AdapterStatus {
    return { platform: "x", state: this.state, unlock: this.unlockState, detail: "X Chat · Mautrix connector",
      sync: { lastCheckedAt: this.checkedAt || undefined, lastMessageAt: this.lastMessageAt || undefined, pendingChats: this.jobs.size,
        history: this.checkedAt ? { recentReady: this.completed.size + [...this.jobs.values()].filter(j => !j.recent).length,
          recentPending: [...this.jobs.values()].filter(j => j.recent).length,
          olderPending: [...this.jobs.values()].filter(j => !j.recent).length,
          completed: this.completed.size, discovering: Boolean(this.inboxContinuation), pagesFetched: this.pagesFetched,
          lastProgressAt: this.lastProgressAt || undefined } : undefined,
        blockedChats: [...this.jobs.values()].filter(j => (j.retryAt || 0) > Date.now()).length, retryAt: this.retryAt || undefined,
        chats: [...this.jobs].map(([externalId, job]) => ({ externalId, state: job.retryAt && job.retryAt > Date.now() ? "blocked" : "queued", retryAt: job.retryAt })) } };
  }
  async stop() { this.stopped = true; this.state = "disconnected"; this.mediaQueue.clear(); clearTimeout(this.timer); clearInterval(this.inboxTimer); await this.rpc.stop(); }
}
