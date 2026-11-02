import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  DisconnectReason,
  getContentType,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
} from "@whiskeysockets/baileys";
import { extFromMime, saveMediaStream } from "../media";
import { downloadWhatsAppMedia, whatsappMediaContent, WhatsAppMediaRecoveryQueue } from "../whatsapp-media-download";
import { DurableRecords } from "../retention";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import { avatarUnavailable } from "../avatar-errors";
import { isGenericDirectIdentity } from "../../src/lib/direct-contact-identity";
import { nativeMutationId } from "../../src/lib/message-mutations";
import type {
  Adapter,
  AdapterStatus,
  ArchiveChatContext,
  InboundMessage,
  MediaType,
  OutboundMedia,
  OutboundReaction,
  ResolvedDirectContact,
  DirectContactContext,
  SentMessage,
  InboundReaction,
} from "./types";

/* Browser-free WhatsApp via Baileys (WebSocket multi-device protocol). ~20-40MB
   per account vs ~400MB for the whatsapp-web.js/Chromium driver, so this is the
   driver to use for multi-account. Select with WHATSAPP_DRIVER=baileys. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const DATA_DIR = process.env.DATA_DIR || process.cwd();

// Quiet logger satisfying Baileys' pino-like interface.
const silent: any = {
  level: "silent",
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return silent;
  },
};

// 1:1 chats are <number>@s.whatsapp.net (or the privacy linked id @lid).
function isIndividual(jid?: string): boolean {
  return !!jid && /@(s\.whatsapp\.net|lid)$/.test(jid);
}
function isGroup(jid?: string): boolean {
  return !!jid && /@g\.us$/.test(jid);
}
// Status updates, broadcast lists and newsletters/channels aren't real chats.
function isSkippable(jid?: string): boolean {
  return !jid || /@(broadcast|newsletter)$/.test(jid);
}

function numberFromJid(jid: string): string {
  return jid.replace(/@.*$/, "").replace(/:\d+$/, "");
}

function mediaTypeFromContent(type?: string): MediaType | null {
  switch (type) {
    case "imageMessage":
      return "image";
    case "videoMessage":
      return "video";
    case "audioMessage":
      return "audio";
    case "stickerMessage":
      return "sticker";
    case "documentMessage":
    case "documentWithCaptionMessage":
      return "file";
    default:
      return null;
  }
}

function extractText(message: any): string {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    ""
  );
}

function quotedMessagePreview(message: any): string {
  const normalized = normalizeMessageContent(message) || message;
  const text = extractText(normalized).trim();
  if (text) return text;
  switch (getContentType(normalized)) {
    case "imageMessage":
      return "Photo";
    case "videoMessage":
      return "Video";
    case "audioMessage":
      return "Voice message";
    case "stickerMessage":
      return "Sticker";
    case "documentMessage":
    case "documentWithCaptionMessage":
      return "File";
    default:
      return "Message";
  }
}

export class WhatsAppBaileysAdapter implements Adapter {
  platform = "whatsapp" as const;
  private sock?: ReturnType<typeof makeWASocket>;
  private state: AdapterStatus["state"] = "starting";
  private qr: string | null = null;
  private detail?: string;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  private onRead?: (chatExternalId: string) => Promise<void>;
  private onReaction?: (r: InboundReaction) => Promise<void>;
  // jid -> display name, from WhatsApp's contacts store (names aren't on
  // history/outbound messages, only the live contacts list).
  private contacts = new Map<string, string>();
  private selfJids = new Set<string>();
  // group jid -> subject (fetched once, cached)
  private groupSubjects = new Map<string, string>();
  private avatarGroupMembers = new Map<string, { expiresAt: number; participants: Array<{ id: string; lid?: string; jid?: string }> }>();
  private authDir: string;
  private proxyUrl?: string;
  private stopped = false;
  private relinking = false;
  private connectionGeneration = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private messageCache = new Map<string, any>();
  private rawMessages: DurableRecords<string>;
  private mediaRecoveries = new WhatsAppMediaRecoveryQueue();
  private credentialsWrite: Promise<void> = Promise.resolve();
  private connectionPromise?: Promise<void>;
  private reconnectAttempts = 0;
  private lastMessageSavedAt = 0;
  private historyRequests = new Map<
    string,
    {
      chatExternalId: string;
      timedOut?: boolean;
      sinceTimestamp?: number;
      timer: ReturnType<typeof setTimeout>;
      resolve: () => void;
      reject: (error: Error) => void;
    }
  >();

  // clientId namespaces the auth folder so multiple accounts don't collide.
  constructor(opts: { proxyUrl?: string; clientId?: string } = {}) {
    this.proxyUrl = opts.proxyUrl;
    this.authDir = path.join(
      DATA_DIR,
      ".baileys_auth",
      (opts.clientId || "default").replace(/[^a-zA-Z0-9_.-]/g, "_")
    );
    this.rawMessages = new DurableRecords(path.join(DATA_DIR, ".local", "whatsapp-messages", (opts.clientId || "default").replace(/[^a-zA-Z0-9_.-]/g, "_")));
  }

  getStatus(): AdapterStatus {
    return {
      platform: "whatsapp",
      state: this.state,
      qr: this.state === "qr" ? this.qr : null,
      detail: this.detail,
      sync: {
        lastMessageAt: this.lastMessageSavedAt || undefined,
        pendingChats: new Set([...this.historyRequests.values()].filter(r => !r.timedOut).map(r => r.chatExternalId)).size,
        blockedChats: new Set([...this.historyRequests.values()].filter(r => r.timedOut).map(r => r.chatExternalId)).size,
        chats: [...this.historyRequests.values()].map(r => ({ externalId: r.chatExternalId.replace(/@s\.whatsapp\.net$/, "@c.us"), state: r.timedOut ? "blocked" as const : "queued" as const })),
      },
    };
  }

  async ensureReady(): Promise<void> {
    if (this.state !== "ready" || !this.sock || !this.sock.ws.isOpen) {
      throw new Error("WhatsApp is reconnecting");
    }
  }

  async recover(): Promise<void> {
    if (this.stopped) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionGeneration++;
    await this.credentialsWrite;
    this.state = "starting";
    try {
      this.sock?.end(new Error("Restarting an unresponsive WhatsApp connection"));
    } catch {
      /* the old socket is already closed */
    }
    await this.connect();
  }

  private lastQrRefreshAt = 0;
  async refreshQr(): Promise<void> {
    if (this.state !== "qr" || this.sock?.user) throw new Error("WhatsApp is already linking. Wait for its status to update.");
    if (Date.now() - this.lastQrRefreshAt < 15_000) throw new Error("Wait a few seconds for the new QR code before requesting another.");
    this.lastQrRefreshAt = Date.now();
    this.qr = null;
    this.detail = "Generating a new QR code";
    await this.recover();
  }

  async start(
    onMessage: (m: InboundMessage) => Promise<void>,
    onRead?: (chatExternalId: string) => Promise<void>,
    onReaction?: (r: InboundReaction) => Promise<void>
  ): Promise<void> {
    this.onMessage = onMessage;
    this.onRead = onRead;
    this.onReaction = onReaction;
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.connectOnce().finally(() => { this.connectionPromise = undefined; });
    return this.connectionPromise;
  }

  private async connectOnce(): Promise<void> {
    const generation = ++this.connectionGeneration;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    await this.credentialsWrite;
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    // WhatsApp mentions our own account by its privacy LID in groups. Seed both
    // account identities so those mentions resolve to the signed-in display
    // name instead of a raw number.
    const me = state.creds.me as { id?: string; lid?: string; name?: string } | undefined;
    if (me) {
      for (const id of [me.id, me.lid]) {
        if (id) {
          const normalizedId = jidNormalizedUser(id);
          this.selfJids.add(normalizedId);
          if (me.name) this.contacts.set(normalizedId, me.name);
        }
      }
    }
    const { version } = await fetchLatestBaileysVersion();
    if (this.stopped || generation !== this.connectionGeneration) return;
    // TODO(proxy): route the WS through this.proxyUrl per-account via an Agent
    // (needs https-proxy-agent). Omitted for now to keep the adapter dependency-light.

    const sock = makeWASocket({
      version,
      auth: state,
      logger: silent,
      browser: ["2 Many DMs", "Chrome", "1.0.0"],
      // Phone-delivered history is persisted without downloading binaries in
      // this event. It is independent of the old heavy browser startup import.
      syncFullHistory: true,
      markOnlineOnConnect: false,
      getMessage: async key => {
        const cached = this.readMessage(`whatsapp:${jidNormalizedUser(key.remoteJid || "")}:${key.id}`);
        return cached?.message;
      },
    });
    this.sock = sock;

    sock.ev.on("creds.update", () => {
      if (generation !== this.connectionGeneration || this.stopped) return;
      this.credentialsWrite = this.credentialsWrite.then(saveCreds).catch(error => {
        console.error("[whatsapp:baileys] credentials save failed:", error);
      });
    });

    sock.ev.on("connection.update", async (u: any) => {
      if (generation !== this.connectionGeneration || this.stopped) return;
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        this.state = "qr";
        this.detail = "Scan to relink WhatsApp";
        try {
          const image = await QRCode.toDataURL(qr, { margin: 4, width: 320 });
          if (generation !== this.connectionGeneration || this.stopped || this.state !== "qr") return;
          this.qr = image;
        } catch {
          this.qr = null;
        }
        console.log(
          "\n[whatsapp:baileys] Scan in the app (Connections panel) or this terminal QR:\n"
        );
        qrcodeTerminal.generate(qr, { small: true });
      }
      if (connection === "open") {
        this.state = "ready";
        this.relinking = false;
        this.reconnectAttempts = 0;
        this.qr = null;
        const me = sock.user?.id ? numberFromJid(sock.user.id) : undefined;
        this.detail = me ? "+" + me : undefined;
        console.log("[whatsapp:baileys] ready", this.detail || "");
      }
      if (connection === "close") {
        this.connectionGeneration++; // Retire events from this socket immediately.
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        // A sleeping laptop commonly wakes to 408/428/515. Those are transient:
        // keep the UI in Connecting and rebuild the socket automatically.
        this.state = loggedOut ? "disconnected" : "starting";
        this.qr = null;
        this.detail = loggedOut
          ? "Logged out — preparing a new QR"
          : `Reconnecting automatically${code ? ` (${code})` : ""}`;
        console.error(
          `[whatsapp:baileys] connection closed (code ${code})${
            loggedOut ? " — logged out" : ""
          }`
        );
        if (loggedOut && !this.stopped && !this.relinking) {
          this.relinking = true;
          await this.credentialsWrite;
          // Preserve the rejected credentials for recovery/debugging, then
          // reconnect with an empty auth directory so Baileys emits a new QR.
          const archived = `${this.authDir}.logged-out-${Date.now()}`;
          try {
            if (fs.existsSync(this.authDir)) fs.renameSync(this.authDir, archived);
            console.log(`[whatsapp:baileys] archived logged-out session → ${archived}`);
          } catch (e) {
            console.error("[whatsapp:baileys] could not archive logged-out session:", e);
          }
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (!this.stopped) {
              this.connect().catch((e) => {
                this.relinking = false;
                console.error("[whatsapp:baileys] relink failed:", e);
              });
            }
          }, 1200);
        } else if (!loggedOut && !this.stopped) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (!this.stopped) {
              this.connect().catch((e) =>
                console.error("[whatsapp:baileys] reconnect failed:", e)
              );
            }
          }, code === DisconnectReason.restartRequired ? 1200 : Math.min(60_000, 2000 * 2 ** Math.min(this.reconnectAttempts++, 5)));
        }
      }
    });

    // Live messages (and our own echoed sends, fromMe).
    sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (generation !== this.connectionGeneration || this.stopped) return;
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        try {
          const im = await this.toInbound(msg, false);
          if (im && type === "append") im.historical = true;
          if (im && this.onMessage) {
            await this.onMessage(im);
            this.lastMessageSavedAt = Date.now();
          }
        } catch (e) {
          console.error("[whatsapp:baileys] message handler error:", e);
        }
      }
    });

    // Names live in the contacts store, delivered separately from messages.
    // WhatsApp sends the reactor's current emoji for a message; an empty
    // string means they removed it.
    sock.ev.on("messages.reaction", async (reactions: any[]) => {
      if (!this.onReaction) return;
      for (const r of reactions || []) {
        try {
          const chatId = r?.key?.remoteJid;
          const msgId = r?.key?.id;
          if (!chatId || !msgId) continue;
          const actor = r?.reaction?.key?.participant || r?.key?.participant || chatId;
          const emoji = r?.reaction?.text || "";
          await this.onReaction({
            platform: "whatsapp",
            messageExternalId: `whatsapp:${chatId}:${msgId}`,
            actor: { externalKey: `whatsapp:${String(actor).split("@")[0]}` },
            emojis: emoji ? [emoji] : [],
          });
        } catch (e) {
          console.error("[whatsapp:baileys] reaction error:", e);
        }
      }
    });

    sock.ev.on("contacts.upsert", (cs: any[]) => {
      if (generation === this.connectionGeneration) this.rememberContacts(cs);
    });
    sock.ev.on("contacts.update", (cs: any[]) => {
      if (generation === this.connectionGeneration) this.rememberContacts(cs);
    });
    const rememberChats = (chats: any[]) => {
      if (generation !== this.connectionGeneration || this.stopped) return;
      for (const chat of chats || []) {
        const id = chat?.id && jidNormalizedUser(chat.id);
        const name = chat?.subject || chat?.name;
        if (id && name && isGroup(id)) this.groupSubjects.set(id, name);
      }
    };
    sock.ev.on("chats.upsert", rememberChats);
    sock.ev.on("groups.upsert", rememberChats);
    sock.ev.on("groups.update", rememberChats);

    // Initial history sync (backfill arrives as an event, not a pull).
    sock.ev.on("messaging-history.set", async ({
      messages,
      contacts,
      chats,
      peerDataRequestSessionId,
    }: any) => {
      if (generation !== this.connectionGeneration || this.stopped) return;
      this.rememberContacts(contacts);
      rememberChats(chats);
      const requestId = peerDataRequestSessionId
        ? String(peerDataRequestSessionId)
        : "";
      const pending = requestId ? this.historyRequests.get(requestId) : undefined;
      let count = 0;
      for (const msg of messages || []) {
        try {
          const im = await this.toInbound(msg, false);
          if (
            im &&
            this.onMessage &&
            (!pending?.sinceTimestamp ||
              im.timestamp.getTime() >= pending.sinceTimestamp)
          ) {
            im.historical = true;
            await this.onMessage(im);
            count++;
          }
        } catch {
          /* skip unreadable history item */
        }
      }
      if (count) console.log(`[whatsapp:baileys] backfilled ${count} messages`);
      if (pending) {
        clearTimeout(pending.timer);
        this.historyRequests.delete(requestId);
        pending.resolve();
      }
    });

    // Read-on-phone -> clear the badge here (two-way read sync).
    sock.ev.on("chats.update", async (updates: any[]) => {
      if (!this.onRead) return;
      for (const c of updates) {
        const jid = c.id;
        if (jid && isIndividual(jid) && (c.unreadCount === 0 || c.unreadCount === null)) {
          this.onRead(jid).catch(() => {});
        }
      }
    });
  }

  private rememberContacts(list?: any[]): void {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      const id = c?.id ? jidNormalizedUser(c.id) : "";
      const name = c?.name || c?.verifiedName || c?.notify;
      if (id && name) this.contacts.set(id, name);
    }
  }

  private readMessage(key: string): any {
    key = key.replace(/@c\.us(?=:|$)/g, "@s.whatsapp.net");
    const cached = this.messageCache.get(key);
    if (cached) return cached;
    const saved = this.rawMessages.get(key);
    return saved ? proto.WebMessageInfo.decode(Buffer.from(saved, "base64")) : undefined;
  }

  private rememberMessage(key: string, message: any): void {
    this.messageCache.set(key, message);
    this.rawMessages.put(key, Buffer.from(proto.WebMessageInfo.encode(message).finish()).toString("base64"));
    if (this.messageCache.size > 2000) this.messageCache.delete(this.messageCache.keys().next().value!);
  }

  private async downloadAttachment(message: any, automatic: boolean) {
    const key = `whatsapp:${jidNormalizedUser(message.key.remoteJid)}:${message.key.id}`;
    return downloadWhatsAppMedia(message, {
      automatic,
      download: (current, signal) => {
        const {content, type} = whatsappMediaContent(current);
        return downloadContentFromMessage(content, type === "file" ? "document" : type, {options: {timeout: 60_000, signal}});
      },
      refresh: current => this.sock!.updateMediaMessage(current),
      remember: current => this.rememberMessage(key, current),
      save: (stream, {content, type}, maxBytes) => saveMediaStream(key,
        extFromMime(content.mimetype || "", type === "sticker" ? "webp" : "bin"), stream, maxBytes),
    });
  }

  private async toInbound(msg: any, downloadMedia = true): Promise<InboundMessage | null> {
    const jid: string | undefined = msg.key?.remoteJid;
    if (isSkippable(jid) || (!isIndividual(jid) && !isGroup(jid))) return null;
    if (!msg.message) return null; // protocol/empty
    const group = isGroup(jid);
    const norm = jidNormalizedUser(jid!);
    const number = numberFromJid(norm);
    // Cache the sender's display name from live 1:1 traffic — for @lid privacy
    // chats and history (which lack names) this is the only source. In groups
    // pushName is the sender (not the chat), so don't cache it as the name.
    if (!group && !msg.key?.fromMe && msg.pushName)
      this.contacts.set(norm, msg.pushName);
    // Group subject, fetched once and cached.
    if (downloadMedia && group && !this.groupSubjects.has(norm)) {
      try {
        const md = await this.sock!.groupMetadata(norm);
        if (md?.subject) this.groupSubjects.set(norm, md.subject);
      } catch {
        /* no access / left the group */
      }
    }
    const normalizedMessage = normalizeMessageContent(msg.message) || msg.message;
    const contentType = getContentType(normalizedMessage);
    const body = extractText(normalizedMessage);
    const mt = mediaTypeFromContent(contentType);

    // Group membership, shared-history and encryption notices arrive as
    // protocol messages. They have a message envelope but no user-visible text
    // or media; importing them creates blank chat bubbles.
    if (!body && !mt) return null;

    const avatarKey = `whatsapp_${norm}`;
    let avatarUrl = existingAvatar(avatarKey) || undefined;
    if (downloadMedia && !avatarUrl) {
      try {
        const picUrl = await this.sock!.profilePictureUrl(norm, "image");
        if (picUrl)
          avatarUrl = (await saveAvatarFromUrl(avatarKey, picUrl)) || undefined;
      } catch {
        /* no picture / privacy */
      }
    }

    const tsRaw = msg.messageTimestamp;
    const tsNum =
      typeof tsRaw === "number"
        ? tsRaw
        : typeof tsRaw === "object" && tsRaw
          ? Number(tsRaw.low ?? tsRaw.toNumber?.() ?? 0)
          : Number(tsRaw || 0);

    const base: InboundMessage = {
      platform: "whatsapp",
      chatExternalId: norm,
      messageExternalId: `whatsapp:${norm}:${msg.key.id}`,
      direction: msg.key.fromMe ? "out" : "in",
      body,
      timestamp: new Date((tsNum || Math.floor(Date.now() / 1000)) * 1000),
      contact: {
        externalKey: `whatsapp:${norm}`,
        // Groups are named by subject. For 1:1, prefer the contacts store;
        // pushName is only valid for inbound (the sender) — for our own sends
        // it'd be *our* name, so skip it.
        name: group
          ? this.groupSubjects.get(norm) || "Group chat"
          : this.contacts.get(norm) ||
            (msg.key?.fromMe ? "" : msg.pushName) ||
            number,
        handle: group ? "Group" : "+" + number,
        avatarUrl,
      },
      isGroup: group,
    };

    const messageContent = contentType
      ? (normalizedMessage as any)?.[contentType]
      : undefined;
    const replyContext = messageContent?.contextInfo;
    if (
      group &&
      !msg.key?.fromMe &&
      Array.isArray(replyContext?.mentionedJid) &&
      replyContext.mentionedJid.some((jid: string) =>
        this.selfJids.has(jidNormalizedUser(jid))
      )
    ) {
      base.mentionsMe = true;
    }
    if (replyContext?.stanzaId) {
      base.replyToExternalKey = `whatsapp:${norm}:${replyContext.stanzaId}`;
      base.replyPreview = quotedMessagePreview(replyContext.quotedMessage);
      const participant = replyContext.participant
        ? jidNormalizedUser(replyContext.participant)
        : undefined;
      if (participant) {
        const currentParticipant = msg.key?.participant || msg.participant;
        const currentParticipantId = currentParticipant
          ? jidNormalizedUser(currentParticipant)
          : !msg.key?.fromMe && !group
            ? norm
            : undefined;
        base.replySender = this.selfJids.has(participant)
          ? "You"
          : this.contacts.get(participant) ||
            (participant === currentParticipantId ? msg.pushName : undefined) ||
            numberFromJid(participant);
      }
    }
    this.rememberMessage(base.messageExternalId, msg);

    // Attribute group messages to the member who sent them (for member tags).
    if (group && !msg.key?.fromMe) {
      const participant: string | undefined =
        msg.key?.participant || msg.participant;
      if (participant) {
        const pnorm = jidNormalizedUser(participant);
        const senderAvatarKey = `whatsapp_${pnorm}`;
        let senderAvatarUrl = existingAvatar(senderAvatarKey) || undefined;
        if (downloadMedia && !senderAvatarUrl) {
          try {
            const picture = await this.sock!.profilePictureUrl(pnorm, "image");
            if (picture) senderAvatarUrl = (await saveAvatarFromUrl(senderAvatarKey, picture)) || undefined;
          } catch {
            /* no picture / privacy */
          }
        }
        base.sender = {
          externalKey: `whatsapp:${pnorm}`,
          name: msg.pushName || numberFromJid(pnorm),
          avatarUrl: senderAvatarUrl,
        };
        if (msg.pushName && !isGenericDirectIdentity(msg.pushName)) this.contacts.set(pnorm, msg.pushName);
      }
    }

    if (mt) {
      const content: any = (normalizedMessage as any)[contentType!];
      base.media = { type: mt, url: null, name: content?.fileName, isGif: content?.gifPlayback === true };
      if (downloadMedia) {
        try { base.media = await this.downloadAttachment(msg, true); }
        catch { /* Preserve the message; paced retention/manual recovery reports the actual failure. */ }
      }
    }

    return base;
  }

  async markRead(chatExternalId: string): Promise<void> {
    // Baileys marks read by message key; we don't track the last key here, so
    // this is a best-effort no-op-safe call. (Read receipts still send when the
    // user replies.) Left intentionally light to avoid sending wrong receipts.
    void chatExternalId;
  }

  async setArchivedAndMuted(
    chatExternalId: string,
    archived: boolean,
    context?: ArchiveChatContext
  ): Promise<void> {
    await this.ensureReady();
    const sock = this.sock!;
    const cached = context?.lastMessageId
      ? this.readMessage(context.lastMessageId)
      : undefined;
    const prefix = `whatsapp:${chatExternalId}:`;
    const nativeId = context?.lastMessageId?.startsWith(prefix)
      ? context.lastMessageId.slice(prefix.length)
      : context?.lastMessageId?.split(":").at(-1);
    const participant = context?.lastMessageParticipant
      ?.replace(/^whatsapp:/, "")
      .replace(/@c\.us$/, "@s.whatsapp.net");
    const timestamp = context?.lastMessageTimestamp
      ? context.lastMessageTimestamp > 1_000_000_000_000
        ? Math.floor(context.lastMessageTimestamp / 1000)
        : context.lastMessageTimestamp
      : undefined;
    const anchor = cached ||
      (nativeId && timestamp
        ? {
            key: {
              remoteJid: jidNormalizedUser(chatExternalId),
              id: nativeId,
              fromMe: context?.lastMessageFromMe === true,
              ...(
                context?.lastMessageFromMe !== true &&
                isGroup(chatExternalId) &&
                participant
                  ? { participant: jidNormalizedUser(participant) }
                  : {}
              ),
            },
            messageTimestamp: timestamp,
          }
        : undefined);

    if (!anchor) {
      throw new Error(
        "WhatsApp needs one synced message before this chat can be archived."
      );
    }
    if (
      isGroup(chatExternalId) &&
      !anchor.key?.fromMe &&
      !anchor.key?.participant
    ) {
      throw new Error(
        "WhatsApp needs the latest group sender before this chat can be archived. Sync it and try again."
      );
    }

    const setArchived = (value: boolean) =>
      sock.chatModify({ archive: value, lastMessages: [anchor] }, jidNormalizedUser(chatExternalId));
    const setMuted = (muted: boolean) =>
      sock.chatModify({ mute: muted ? -1 : null }, jidNormalizedUser(chatExternalId));

    if (archived) {
      await setMuted(true);
      try {
        await setArchived(true);
      } catch (error) {
        await setMuted(false).catch(() => {});
        throw error;
      }
      return;
    }

    await setArchived(false);
    try {
      await setMuted(false);
    } catch (error) {
      await setArchived(true).catch(() => {});
      throw error;
    }
  }

  async requestHistory(
    chatExternalId: string,
    oldestMessageId: string,
    oldestTimestamp: number,
    count = 100,
    context?: {
      isGroup?: boolean;
      sinceTimestamp?: number;
      anchorFromMe?: boolean;
    }
  ): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp (baileys) not ready");
    if (!oldestMessageId) {
      throw new Error("WhatsApp needs at least one synced message before older history can be requested");
    }
    let historyChatId = jidNormalizedUser(chatExternalId);
    if (historyChatId.endsWith("@lid")) {
      const repo: any = (this.sock as any).signalRepository;
      try {
        const phoneJid =
          (await repo?.lidMapping?.getPNForLID?.(historyChatId)) ||
          (await repo?.getPNForLID?.(historyChatId));
        if (phoneJid) historyChatId = jidNormalizedUser(phoneJid);
      } catch {
        // Keep the LID as a last resort when WhatsApp has not shared its
        // phone-number mapping with this companion session.
      }
    }
    const nativeMessageId = oldestMessageId.replace(
      new RegExp(`^whatsapp:${chatExternalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`),
      ""
    );
    const requestOnce = async () => {
      const requestId = await this.sock!.fetchMessageHistory(
        // WhatsApp's on-demand history protocol accepts at most 50 messages per
        // request. Larger values are accepted locally but the phone never sends
        // a history response, which made the UI appear stuck.
        Math.max(1, Math.min(count, 50)),
        {
          remoteJid: historyChatId,
          id: nativeMessageId,
          fromMe: context?.anchorFromMe === true,
        },
        // WhatsApp's on-demand protocol expects milliseconds. Older Baileys
        // examples passed WAMessage.messageTimestamp (seconds), causing the
        // phone to silently ignore otherwise valid history requests.
        oldestTimestamp > 1_000_000_000_000
          ? oldestTimestamp
          : oldestTimestamp * 1000
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("WhatsApp did not return the requested history in time."));
          // Keep the request's date filter briefly because the phone can still
          // deliver a late response after the retry has started. Without this,
          // a one-day repair could accidentally import older history.
          const cleanupTimer = setTimeout(() => {
            this.historyRequests.delete(requestId);
          }, 2 * 60_000);
          const pending = this.historyRequests.get(requestId);
          if (pending) { pending.timer = cleanupTimer; pending.timedOut = true; }
        }, 9_000);
        this.historyRequests.set(requestId, {
          chatExternalId,
          sinceTimestamp: context?.sinceTimestamp,
          timer,
          resolve,
          reject,
        });
      });
    };

    try {
      await requestOnce();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "WhatsApp did not return the requested history in time."
      ) {
        throw error;
      }
      // The phone occasionally ignores a valid peer-history request. Retry
      // once with the same stable anchor; database upserts keep this idempotent.
      await new Promise((resolve) => setTimeout(resolve, 750));
      await requestOnce();
    }
  }

  recoverMedia(
    chatExternalId: string,
    messageExternalId: string,
    options: { automatic?: boolean } = {}
  ): Promise<void> {
    const key = messageExternalId.replace(/@c\.us(?=:|$)/g, "@s.whatsapp.net");
    return this.mediaRecoveries.run(key, options.automatic === true,
      () => this.recoverMediaNow(chatExternalId, key, options.automatic === true));
  }

  private async recoverMediaNow(
    chatExternalId: string,
    messageExternalId: string,
    automatic: boolean
  ): Promise<void> {
    if (!this.onMessage || !this.sock) {
      throw new Error("WhatsApp is not ready");
    }
    await this.ensureReady();
    const message = this.readMessage(messageExternalId);
    if (!message) {
      throw new Error(
        "This attachment's download details are missing from the linked device history. Open the chat in WhatsApp on your phone, then use Chat history here and retry."
      );
    }
    const chat = jidNormalizedUser(chatExternalId.replace(/@c\.us$/, "@s.whatsapp.net"));
    if (jidNormalizedUser(message.key?.remoteJid || "") !== chat || messageExternalId !== `whatsapp:${chat}:${message.key?.id}`) {
      throw new Error("WhatsApp could not verify this attachment belongs to the selected chat.");
    }
    // Recovery must not depend on unrelated group/avatar lookups and must not
    // swallow errors or apply the automatic 25 MB budget to a manual click.
    const recovered = await this.toInbound(message, false);
    if (!recovered?.media) throw new Error("This WhatsApp message does not contain a downloadable attachment.");
    recovered.media = await this.downloadAttachment(message, automatic);
    recovered.historical = true;
    await this.onMessage(recovered);
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    mentions?: string[],
    replyToExternalId?: string
  ): Promise<SentMessage> {
    await this.ensureReady();
    const sock = this.sock!;
    let content: any;
    if (media) {
      const buf = fs.readFileSync(media.path);
      if (media.type === "image") content = { image: buf, caption: body || undefined };
      else if (media.type === "video") content = { video: buf, caption: body || undefined };
      else if (media.type === "audio") content = { audio: buf, mimetype: media.mime || "audio/mp4" };
      else if (media.type === "sticker") content = { sticker: buf };
      else
        content = {
          document: buf,
          fileName: media.name,
          mimetype: media.mime || "application/octet-stream",
          caption: body || undefined,
        };
    } else {
      content = {
        text: body,
        ...(mentions?.length
          ? { mentions: mentions.map((jid) => jidNormalizedUser(jid)) }
          : {}),
      };
    }
    const quoted = replyToExternalId ? this.readMessage(replyToExternalId) : undefined;
    const sent: any = await sock.sendMessage(
      jidNormalizedUser(chatExternalId),
      content,
      quoted ? { quoted } : undefined
    );
    const id = sent?.key?.id || Math.random().toString(36).slice(2);
    return {
      messageExternalId: `whatsapp:${chatExternalId}:${id}`,
      timestamp: new Date().toISOString(),
    };
  }

  private mutationKey(chatExternalId: string, messageExternalId: string) {
    const nativeId = nativeMutationId("whatsapp", chatExternalId, messageExternalId);
    const jid = jidNormalizedUser(chatExternalId.replace(/@c\.us$/, "@s.whatsapp.net"));
    const cached = this.readMessage(messageExternalId)?.key;
    if (cached && (!cached.fromMe || jidNormalizedUser(cached.remoteJid || "") !== jid || cached.id !== nativeId)) {
      throw new Error("WhatsApp could not verify your original message in this chat.");
    }
    return { jid, key: cached || { remoteJid: jid, id: nativeId, fromMe: true } };
  }

  async editMessage(chatExternalId: string, messageExternalId: string, body: string): Promise<void> {
    await this.ensureReady();
    const { jid, key } = this.mutationKey(chatExternalId, messageExternalId);
    const result = await this.sock!.sendMessage(jid, { text: body, edit: key });
    if (!result?.key?.id) throw new Error("WhatsApp did not confirm the edit request.");
  }

  async deleteMessage(chatExternalId: string, messageExternalId: string): Promise<void> {
    await this.ensureReady();
    const { jid, key } = this.mutationKey(chatExternalId, messageExternalId);
    const result = await this.sock!.sendMessage(jid, { delete: key });
    if (!result?.key?.id) throw new Error("WhatsApp did not confirm the deletion request.");
  }

  async react(
    chatExternalId: string,
    messageExternalId: string,
    reaction: OutboundReaction
  ): Promise<void> {
    await this.ensureReady();
    const sock = this.sock!;
    const prefix = `whatsapp:${chatExternalId}:`;
    const nativeId = messageExternalId.startsWith(prefix)
      ? messageExternalId.slice(prefix.length)
      : messageExternalId.split(":").at(-1) || "";
    if (!nativeId) throw new Error("WhatsApp message ID is invalid");

    const cachedKey = this.readMessage(messageExternalId)?.key;
    const participant = reaction.senderExternalKey
      ?.replace(/^whatsapp:/, "")
      .replace(/@c\.us$/, "@s.whatsapp.net");
    const key = cachedKey || {
      remoteJid: jidNormalizedUser(chatExternalId),
      id: nativeId,
      fromMe: !!reaction.fromMe,
      ...(!reaction.fromMe && isGroup(chatExternalId) && participant
        ? { participant: jidNormalizedUser(participant) }
        : {}),
    };
    await sock.sendMessage(jidNormalizedUser(chatExternalId), {
      react: { text: reaction.remove ? "" : reaction.emoji, key },
    });
  }

  async createGroup(
    name: string,
    participantKeys: string[]
  ): Promise<{
    chatExternalId: string;
    inviteUrl?: string;
    participantOutcomes: {
      participantKey: string;
      status: "added" | "invite_sent" | "not_added";
      detail?: string;
    }[];
  }> {
    if (!this.sock) throw new Error("WhatsApp (baileys) not ready");
    const sock = this.sock;
    const raw = participantKeys
      .map((k) => k.replace(/^whatsapp:/, ""))
      .filter((j) => j.includes("@"));
    if (!raw.length) throw new Error("no WhatsApp participants");

    // WhatsApp's group API wants phone JIDs (<number>@s.whatsapp.net). Many
    // contacts now arrive as privacy-hidden @lid addresses; groupCreate rejects
    // those with a bare "bad-request". Resolve each to a phone JID — via the
    // signal repo's lid map if this Baileys build has one, else onWhatsApp() —
    // and report the ones we genuinely can't add instead of failing opaquely.
    const repo: any = (sock as any).signalRepository;
    const candidates: {
      participantKey: string;
      directJid: string;
      groupJid?: string;
    }[] = [];
    for (const j of raw) {
      const norm = jidNormalizedUser(j);
      if (norm.endsWith("@s.whatsapp.net")) {
        candidates.push({
          participantKey: `whatsapp:${j}`,
          directJid: norm,
          groupJid: norm,
        });
        continue;
      }
      // @lid → try to recover the phone JID.
      let pn: string | undefined;
      try {
        pn =
          (await repo?.lidMapping?.getPNForLID?.(norm)) ||
          (await repo?.getPNForLID?.(norm)) ||
          undefined;
      } catch {
        /* no mapping in this build */
      }
      candidates.push({
        participantKey: `whatsapp:${j}`,
        directJid: norm,
        groupJid: pn && pn.includes("@") ? jidNormalizedUser(pn) : undefined,
      });
    }
    const jids = candidates
      .map((candidate) => candidate.groupJid)
      .filter((jid): jid is string => !!jid);
    const unresolved = candidates.filter((candidate) => !candidate.groupJid);
    if (!jids.length) {
      throw new Error(
        unresolved.length
          ? `can't add ${unresolved.length} contact(s) by their hidden WhatsApp id — need a phone number. Message them 1:1 first so WhatsApp shares it.`
          : "no resolvable WhatsApp participants"
      );
    }
    const res = await sock.groupCreate(name, jids);
    if (unresolved.length)
      console.warn(
        `[whatsapp:baileys] createGroup: skipped ${unresolved.length} unresolvable @lid contact(s)`
      );

    const fresh = await sock.groupMetadata(res.id).catch(() => res);
    const memberIds = new Set(
      (fresh.participants || []).flatMap((participant) =>
        [participant.id, participant.jid, participant.lid]
          .filter((value): value is string => !!value)
          .map((value) => jidNormalizedUser(value))
      )
    );
    const needsInvite = candidates.some(
      (candidate) =>
        !candidate.groupJid || !memberIds.has(jidNormalizedUser(candidate.groupJid))
    );
    let inviteUrl: string | undefined;
    if (needsInvite) {
      try {
        const code = await sock.groupInviteCode(res.id);
        if (code) inviteUrl = `https://chat.whatsapp.com/${code}`;
      } catch (error) {
        console.error(
          "[whatsapp:baileys] couldn't create a fallback group invite:",
          error
        );
      }
    }

    const participantOutcomes = [] as {
      participantKey: string;
      status: "added" | "invite_sent" | "not_added";
      detail?: string;
    }[];
    for (const candidate of candidates) {
      if (
        candidate.groupJid &&
        memberIds.has(jidNormalizedUser(candidate.groupJid))
      ) {
        participantOutcomes.push({
          participantKey: candidate.participantKey,
          status: "added",
        });
        continue;
      }

      let sent = false;
      if (inviteUrl) {
        try {
          await sock.sendMessage(candidate.directJid, {
            text: `I couldn't add you to “${name}” directly, so here is the group link: ${inviteUrl}`,
          });
          sent = true;
        } catch (error) {
          console.error(
            `[whatsapp:baileys] couldn't send group invite to ${candidate.directJid}:`,
            error
          );
        }
      }
      participantOutcomes.push({
        participantKey: candidate.participantKey,
        status: sent ? "invite_sent" : "not_added",
        detail: sent
          ? "Group link sent in a private WhatsApp message."
          : "WhatsApp could not add this person or deliver the group link.",
      });
    }

    return { chatExternalId: res.id, inviteUrl, participantOutcomes };
  }

  async refreshAvatar(chatExternalId: string, _isGroup?: boolean, context?: DirectContactContext): Promise<import("./types").AvatarRefreshResult> {
    if (!this.sock || this.getStatus().state !== "ready") throw new Error("WhatsApp is reconnecting");
    const jid = jidNormalizedUser(chatExternalId.replace(/@c\.us$/, "@s.whatsapp.net"));
    const pictureFor = async (id: string) => {
      try { return await this.sock!.profilePictureUrl(id, "image", 15_000); }
      catch (error) { if (avatarUnavailable(error)) return undefined; throw error; }
    };
    let picture = await pictureFor(jid);
    if (!picture && jid.endsWith("@lid") && context?.groupExternalId?.endsWith("@g.us")) {
      // LIDs are not phone numbers. Retry a phone alias only when WhatsApp's
      // membership record explicitly links it to this exact LID.
      let group = this.avatarGroupMembers.get(context.groupExternalId);
      if (!group || group.expiresAt < Date.now()) {
        try {
          const metadata = await this.sock.groupMetadata(context.groupExternalId);
          group = { participants: metadata.participants, expiresAt: Date.now() + 5 * 60_000 };
          this.avatarGroupMembers.set(context.groupExternalId, group);
        } catch (error) { if (!avatarUnavailable(error)) throw error; }
      }
      const member = group?.participants.find(item => [item.id, item.lid, item.jid].some(id => id && jidNormalizedUser(id) === jid));
      const phone = [member?.id, member?.jid].find(id => id && /@(s\.whatsapp\.net|c\.us)$/.test(id));
      if (phone) picture = await pictureFor(jidNormalizedUser(phone));
    }
    if (picture) {
      const url = await saveAvatarFromUrl(`whatsapp_${jid}`, picture);
      if (!url) throw new Error("Avatar download failed");
      return { url, source: "downloaded" };
    }
    return { source: "unavailable" };
  }

  async resolveDirectContact(target: string, context?: DirectContactContext): Promise<ResolvedDirectContact> {
    await this.ensureReady();
    const exactId = target
      .trim()
      .replace(/^whatsapp:/, "")
      .replace(/@c\.us$/, "@s.whatsapp.net");
    if (/@(?:s\.whatsapp\.net|lid)$/.test(exactId)) {
      const chatExternalId = jidNormalizedUser(exactId);
      const aliases = new Set([chatExternalId]);
      // Names come from this exact sender's message, never another member or
      // a display-name match. Raw messages survive connector restarts.
      const evidence = context?.senderMessageExternalId ? this.readMessage(context.senderMessageExternalId) : undefined;
      const participant = evidence?.key?.participant || evidence?.participant;
      const senderName = participant && jidNormalizedUser(participant) === chatExternalId ? evidence?.pushName : undefined;
      if (context?.groupExternalId?.endsWith("@g.us")) {
        try {
          const metadata = await this.sock!.groupMetadata(context.groupExternalId);
          const member = metadata.participants.find(member => [member.id, member.lid, member.jid]
            .some(id => id && jidNormalizedUser(id) === chatExternalId));
          for (const id of [member?.id, member?.lid, member?.jid]) {
            if (id && /@(lid|s\.whatsapp\.net|c\.us)$/.test(id)) aliases.add(jidNormalizedUser(id));
          }
        } catch { /* Exact LID remains messageable when metadata is unavailable. */ }
      }
      const name = [...aliases].map(id => this.contacts.get(id)).concat(senderName)
        .find(name => name && !isGenericDirectIdentity(name)) || "WhatsApp member";
      if (!isGenericDirectIdentity(name)) for (const id of aliases) this.contacts.set(id, name);
      const phoneId = [...aliases].find(id => id.endsWith("@s.whatsapp.net"));
      const handle = phoneId ? `+${numberFromJid(phoneId)}` : name;
      const avatarKey = `whatsapp_${chatExternalId}`;
      let avatarUrl = existingAvatar(avatarKey) || undefined;
      if (!avatarUrl) {
        try {
          const picture = await this.sock!.profilePictureUrl(chatExternalId, "image");
          if (picture)
            avatarUrl = (await saveAvatarFromUrl(avatarKey, picture)) || undefined;
        } catch {
          // Profile photos are optional and commonly hidden by privacy settings.
        }
      }
      return {
        chatExternalId,
        externalKey: `whatsapp:${chatExternalId}`,
        name,
        handle,
        avatarUrl,
        aliases: [...aliases],
      };
    }
    const digits = target.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      throw new Error("Enter a WhatsApp number with its country code.");
    }
    const requestedJid = `${digits}@s.whatsapp.net`;
    const matches = await this.sock!.onWhatsApp(requestedJid);
    const match = matches?.find((candidate: any) => candidate?.exists);
    if (!match?.jid) {
      throw new Error("That number is not registered on WhatsApp.");
    }
    const chatExternalId = jidNormalizedUser(match.jid);
    const name = this.contacts.get(chatExternalId) || `+${digits}`;

    const avatarKey = `whatsapp_${chatExternalId}`;
    let avatarUrl = existingAvatar(avatarKey) || undefined;
    if (!avatarUrl) {
      try {
        const picture = await this.sock!.profilePictureUrl(chatExternalId, "image");
        if (picture)
          avatarUrl = (await saveAvatarFromUrl(avatarKey, picture)) || undefined;
      } catch {
        // Profile photos are optional and commonly hidden by privacy settings.
      }
    }

    return {
      chatExternalId,
      externalKey: `whatsapp:${chatExternalId}`,
      name,
      handle: `+${digits}`,
      avatarUrl,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connectionGeneration++;
    await this.credentialsWrite;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    for (const pending of this.historyRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("WhatsApp stopped before history was returned."));
    }
    this.historyRequests.clear();
    try {
      this.sock?.end(undefined);
    } catch {
      /* already closed */
    }
  }
}
