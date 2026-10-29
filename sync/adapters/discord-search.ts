import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { PrismaClient } from "@prisma/client";
import type { Adapter, AdapterStatus, InboundMessage, SentMessage } from "./types";
import { discordReadPath, discordRetryDelay, privateDiscordMessage, type DiscordPerson, type DiscordPrivateChat, type DiscordSearchMessage } from "../discord-search-core";

type Progress = { before?: string; complete?: boolean; latestId?: string; since: number; blockedUntil?: number; recent?: { before?: string; stopId?: string; latestId?: string } };
type Checkpoint = { version: 1; userId: string; chats: Record<string, Progress> };
type HistoryJob = { chatId: string; before?: string; since: number; stopId?: string; mode: "recent" | "history"; latestId?: string };
export type DiscordSearchSession = { token: string; userId: string; username: string };

/** Explicitly read-only personal inbox index. No send, react, acknowledge,
 * relationship, presence, channel creation, or moderation REST operations. */
export class DiscordSearchAdapter implements Adapter {
  platform = "discord" as const;
  private status: AdapterStatus = { platform: "discord", state: "starting", detail: "Connecting Discord search…" };
  private abort = new AbortController();
  private socket?: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private refresh?: ReturnType<typeof setInterval>;
  private heartbeatAck = true;
  private sequence: number | null = null;
  private sessionId?: string;
  private attempts = 0;
  private stopped = false;
  private fatal = false;
  private nextRequestAt = 0;
  private requestQueue: Promise<unknown> = Promise.resolve();
  private eventQueue: Promise<unknown> = Promise.resolve();
  private historyRunning = false;
  private refreshing?: Promise<void>;
  private jobs: HistoryJob[] = [];
  private channels = new Map<string, DiscordPrivateChat>();
  private checkpoint: Checkpoint;
  private checkpointFile: string;
  private onMessage?: (message: InboundMessage) => Promise<void>;
  private lastCheckedAt?: number;
  private lastMessageAt?: number;
  private retryAt?: number;
  private existingContacts = new Map<string, { externalKey: string | null; name: string; handle: string }>();

  constructor(private session: DiscordSearchSession, private accountId: string) {
    if (!session.token || !/^\d+$/.test(session.userId) || !/^[a-zA-Z0-9_-]+$/.test(accountId)) throw new Error("Reconnect Discord search.");
    this.checkpoint = { version: 1, userId: session.userId, chats: {} };
    this.checkpointFile = path.join(process.env.DATA_DIR || process.cwd(), ".local", "discord-search", `${accountId}.json`);
  }
  getStatus(): AdapterStatus {
    const blocked = Object.entries(this.checkpoint.chats).filter(([, p]) => (p.blockedUntil || 0) > Date.now());
    return { ...this.status, detail: this.status.state === "ready" ? `@${this.session.username} · live, read-only · ${this.channels.size} chats · ${new Set(this.jobs.map(j => j.chatId)).size} checking history` : this.status.detail,
      sync: { lastCheckedAt: this.lastCheckedAt, lastMessageAt: this.lastMessageAt, pendingChats: new Set(this.jobs.map(j => j.chatId)).size,
        blockedChats: blocked.length, retryAt: this.retryAt, chats: blocked.map(([externalId, p]) => ({ externalId, state: "blocked", retryAt: p.blockedUntil })) } };
  }
  async send(): Promise<SentMessage> { throw new Error("Discord search is read-only. Reply in Discord."); }
  matchesSession(raw: string | null) {
    try { const other = JSON.parse(raw || "{}"); return other.token === this.session.token && other.userId === this.session.userId; } catch { return false; }
  }
  async start(onMessage: (message: InboundMessage) => Promise<void>) {
    try { await this.initialize(onMessage); }
    catch (error) {
      if (!this.fatal) this.status = { platform: "discord", state: "disconnected", detail: error instanceof Error ? error.message : "Discord search could not start. Reconnect to try again." };
      if (!this.stopped && !this.fatal) {
        this.reconnect = setTimeout(() => { void this.start(onMessage).catch(() => undefined); }, 60_000);
        this.reconnect.unref();
      }
      throw error;
    }
  }
  private async initialize(onMessage: (message: InboundMessage) => Promise<void>) {
    this.onMessage = onMessage;
    try {
      const stored = JSON.parse(await fs.readFile(this.checkpointFile, "utf8")) as Checkpoint;
      if (stored.version === 1 && stored.userId === this.session.userId && stored.chats && typeof stored.chats === "object") this.checkpoint = stored;
    } catch { /* First run or incomplete checkpoint: native IDs safely dedupe a replay. */ }
    const user = await this.request<DiscordPerson>("/users/@me");
    if (user.id !== this.session.userId || user.bot) {
      this.fatal = true;
      this.status = { platform: "discord", state: "disconnected", detail: "Discord search account identity changed. Reconnect the intended account." };
      throw new Error(this.status.detail);
    }
    const db = new PrismaClient();
    try {
      const existing = await db.conversation.findMany({ where: { accountId: this.accountId, platform: "discord" }, select: { externalId: true, contact: { select: { externalKey: true, name: true, handle: true } } } });
      for (const row of existing) if (row.externalId) this.existingContacts.set(row.externalId, row.contact);
    } finally { await db.$disconnect(); }
    await this.refreshChats();
    this.openGateway();
    this.refresh = setInterval(() => { void this.refreshChats().catch(() => { /* surfaced through status / next retry */ }); }, 5 * 60_000);
    this.refresh.unref();
  }
  private request<T>(route: string): Promise<T> {
    if (!discordReadPath(route)) return Promise.reject(new Error("Discord search only permits inbox reads."));
    const run = async (): Promise<T> => {
      if (this.stopped || this.fatal) throw new Error("Discord search is stopped.");
      for (let attempt = 0; attempt < 3; attempt++) {
        const wait = Math.max(0, this.nextRequestAt - Date.now());
        if (wait) await sleep(wait, undefined, { signal: this.abort.signal });
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]);
        const response = await fetch(`https://discord.com/api/v10${route}`, { method: "GET", headers: { Authorization: this.session.token }, signal });
        this.nextRequestAt = Date.now() + 1500;
        const data = await response.json().catch(() => ({}));
        if (response.status === 429) {
          this.retryAt = Date.now() + discordRetryDelay(data.retry_after, response.headers.get("retry-after"));
          this.nextRequestAt = this.retryAt;
          continue;
        }
        if (response.status === 401) {
          this.fatal = true;
          this.status = { platform: "discord", state: "disconnected", detail: "Discord login expired. Reconnect to resume search indexing; saved messages are safe." };
          this.socket?.close();
          throw new Error("Discord login expired.");
        }
        if (!response.ok) throw new Error(`Discord inbox read failed (${response.status}).`);
        if (response.headers.get("x-ratelimit-remaining") === "0") {
          this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + discordRetryDelay(response.headers.get("x-ratelimit-reset-after"), null));
        }
        this.retryAt = undefined;
        return data as T;
      }
      throw new Error("Discord asked to pause history indexing; it will retry automatically.");
    };
    const task = this.requestQueue.then(run, run);
    this.requestQueue = task.catch(() => undefined);
    return task;
  }
  private async saveCheckpoint() {
    await fs.mkdir(path.dirname(this.checkpointFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(`${this.checkpointFile}.tmp`, JSON.stringify(this.checkpoint), { mode: 0o600 });
    await fs.rename(`${this.checkpointFile}.tmp`, this.checkpointFile);
  }
  private refreshChats(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.readChats().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async readChats() {
    const chats = await this.request<DiscordPrivateChat[]>("/users/@me/channels");
    if (!Array.isArray(chats)) throw new Error("Discord did not return a private inbox.");
    const days = Math.max(1, Math.min(3650, Number(process.env.DISCORD_SEARCH_BACKFILL_DAYS) || 90));
    for (const chat of chats.filter(chat => [1, 3].includes(chat.type) && /^\d+$/.test(chat.id))) {
      this.channels.set(chat.id, chat);
      const p = this.checkpoint.chats[chat.id] ||= { since: Date.now() - days * 86400_000 };
      if ((p.blockedUntil || 0) > Date.now() || this.jobs.some(j => j.chatId === chat.id)) continue;
      if (!p.latestId || (chat.last_message_id && chat.last_message_id !== p.latestId)) {
        this.jobs.push({ chatId: chat.id, mode: "recent", since: p.since, stopId: p.latestId, ...p.recent });
      }
      if (!p.complete && p.before && (!p.recent || p.recent.stopId)) this.jobs.push({ chatId: chat.id, mode: "history", since: p.since, before: p.before });
    }
    this.lastCheckedAt = Date.now();
    void this.drainHistory();
  }
  private async ingest(message: DiscordSearchMessage, edited = false) {
    let chat = this.channels.get(message.channel_id);
    // Never index server channels. New private chats are reconciled through
    // the inbox endpoint rather than inferred from a message or a name.
    if (!chat) { await this.refreshChats(); chat = this.channels.get(message.channel_id); }
    if (!chat || !this.onMessage) return;
    const normalized = privateDiscordMessage(chat, message, this.session.userId);
    const existing = this.existingContacts.get(message.channel_id);
    if (normalized && existing?.externalKey) {
      normalized.contact.externalKey = existing.externalKey;
      if (!/^(?:Discord (?:member|group)|Group DM)$/i.test(existing.name)) normalized.contact.name = existing.name;
      if (existing.handle) normalized.contact.handle = existing.handle;
    }
    if (normalized) { await this.onMessage({ ...normalized, sourceEdited: edited }); this.lastMessageAt = Date.now(); }
  }
  private async drainHistory() {
    if (this.historyRunning || this.stopped || this.fatal) return;
    this.historyRunning = true;
    try {
      while (this.jobs.length && !this.stopped && !this.fatal) {
        const job = this.jobs[0];
        const progress = this.checkpoint.chats[job.chatId] ||= { since: job.since };
        try {
          const page = await this.request<DiscordSearchMessage[]>(`/channels/${job.chatId}/messages?limit=100${job.before ? `&before=${job.before}` : ""}`);
          if (!Array.isArray(page)) throw new Error("Invalid Discord history response.");
          if (!job.latestId && page[0]) job.latestId = page[0].id;
          let reachedStop = false;
          for (const message of [...page].reverse()) {
            if (job.stopId && BigInt(message.id) <= BigInt(job.stopId)) { reachedStop = true; continue; }
            if (new Date(message.timestamp).getTime() < job.since) { reachedStop = true; continue; }
            await this.ingest(message);
          }
          const oldest = page.at(-1)?.id;
          const complete = reachedStop || page.length < 100 || !oldest || oldest === job.before;
          this.jobs.shift();
          if (job.mode === "recent") {
            progress.recent = complete ? undefined : { before: oldest, stopId: job.stopId, latestId: job.latestId };
            // Advance the high-water mark only after EVERY intervening page
            // persisted; a restart cannot skip a partially checked gap.
            if (complete && job.latestId) progress.latestId = job.latestId;
          }
          if (!job.stopId || job.mode === "history") {
            progress.before = oldest || progress.before;
            progress.complete = complete;
          }
          progress.blockedUntil = undefined;
          if (!complete) this.jobs.push({ ...job, before: oldest });
          await this.saveCheckpoint();
          this.lastCheckedAt = Date.now();
        } catch {
          if (this.stopped || this.fatal) break;
          progress.blockedUntil = Math.max(this.retryAt || 0, Date.now() + 5 * 60_000);
          this.jobs.shift();
          await this.saveCheckpoint().catch(() => undefined);
        }
      }
    } finally { this.historyRunning = false; }
  }
  async requestHistory(chatId: string, oldestMessageId: string, _oldestTimestamp: number, count = 200, context?: { sinceTimestamp?: number }) {
    if (!this.channels.has(chatId)) throw new Error("This private Discord chat is not accessible to the connected account.");
    let before = context?.sinceTimestamp ? undefined : oldestMessageId.match(/^discord:\d+:(\d+)$/)?.[1];
    for (let remaining = Math.min(count, 500); remaining > 0; remaining -= 100) {
      const page = await this.request<DiscordSearchMessage[]>(`/channels/${chatId}/messages?limit=100${before ? `&before=${before}` : ""}`);
      for (const message of [...page].reverse()) if (!context?.sinceTimestamp || new Date(message.timestamp).getTime() >= context.sinceTimestamp) await this.ingest(message);
      if (context?.sinceTimestamp && page.some(message => new Date(message.timestamp).getTime() < context.sinceTimestamp!)) break;
      if (page.length < 100 || page.at(-1)?.id === before) break;
      before = page.at(-1)?.id;
    }
  }
  private openGateway() {
    if (this.stopped || this.fatal) return;
    this.status = { platform: "discord", state: "starting", detail: "Connecting Discord live search…" };
    const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
    this.socket = socket;
    const handshakeTimeout = setTimeout(() => socket.terminate(), 30_000);
    const send = (op: number, d: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op, d })); };
    socket.on("message", raw => {
      if (socket !== this.socket || this.stopped) return;
      let packet; try { packet = JSON.parse(raw.toString()); } catch { return; }
      if (typeof packet.s === "number") this.sequence = packet.s;
      if (packet.op === 10) {
        this.heartbeatAck = true;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          if (!this.heartbeatAck) { socket.terminate(); return; }
          this.heartbeatAck = false; send(1, this.sequence);
        }, Math.max(5000, Number(packet.d?.heartbeat_interval) || 41250));
        this.heartbeat.unref();
        send(this.sessionId ? 6 : 2, this.sessionId
          ? { token: this.session.token, session_id: this.sessionId, seq: this.sequence }
          : { token: this.session.token, properties: { os: process.platform, browser: "Omni Search", device: "Omni Search" } });
      }
      if (packet.op === 11) this.heartbeatAck = true;
      if (packet.op === 1) send(1, this.sequence);
      if (packet.op === 7) socket.close(4000, "Resume");
      if (packet.op === 9) { this.sessionId = undefined; this.sequence = null; socket.close(4000, "Reconnect"); }
      if (packet.t === "READY" || packet.t === "RESUMED") {
        if (packet.t === "READY" && packet.d?.user?.id !== this.session.userId) {
          this.fatal = true; this.status = { platform: "discord", state: "disconnected", detail: "Discord identity mismatch. Reconnect the intended account." }; socket.close(); return;
        }
        clearTimeout(handshakeTimeout);
        this.sessionId = packet.d?.session_id || this.sessionId;
        this.attempts = 0;
        this.status = { platform: "discord", state: "ready" };
        void this.refreshChats().catch(() => undefined);
      }
      if (packet.t === "MESSAGE_CREATE" && packet.d && !packet.d.guild_id) {
        const message = packet.d as DiscordSearchMessage;
        this.eventQueue = this.eventQueue.then(() => this.ingest(message)).catch(() => {
          // History reconciliation retries persistence failures using native IDs.
          this.lastCheckedAt = undefined;
        });
      }
      if (packet.t === "MESSAGE_UPDATE" && this.channels.has(packet.d?.channel_id) && /^\d+$/.test(packet.d?.id || "")) {
        const { channel_id: channelId, id } = packet.d;
        this.eventQueue = this.eventQueue.then(async () => {
          const message = await this.request<DiscordSearchMessage>(`/channels/${channelId}/messages/${id}`);
          await this.ingest(message, true);
        }).catch(() => { this.lastCheckedAt = undefined; });
      }
      if (packet.t === "CHANNEL_CREATE" || packet.t === "CHANNEL_UPDATE") {
        if ([1, 3].includes(packet.d?.type)) { this.channels.set(packet.d.id, packet.d); void this.refreshChats().catch(() => undefined); }
      }
    });
    socket.on("error", () => { /* close owns reconnect and does not expose credentials */ });
    socket.on("close", code => {
      clearTimeout(handshakeTimeout);
      if (socket !== this.socket) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) {
        this.fatal = true;
        this.status = { platform: "discord", state: "disconnected", detail: `Discord rejected the live connection (${code}). Reconnect; saved search history is safe.` };
      }
      if (this.stopped || this.fatal) return;
      if ([4007, 4009].includes(code)) { this.sessionId = undefined; this.sequence = null; }
      this.status = { platform: "discord", state: "starting", detail: "Discord interrupted the connection. Reconnecting and checking missed messages…" };
      this.reconnect = setTimeout(() => this.openGateway(), Math.min(60_000, 2000 * 2 ** Math.min(5, this.attempts++)));
      this.reconnect.unref();
    });
  }
  async stop() {
    this.stopped = true;
    this.abort.abort();
    if (this.refresh) clearInterval(this.refresh);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close(1000, "Stopped");
    await this.eventQueue.catch(() => undefined);
  }
}
