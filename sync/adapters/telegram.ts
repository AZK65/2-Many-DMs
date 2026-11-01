import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Api, TelegramClient, utils } from "telegram";
import bigInt from "big-integer";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { existingAvatar, saveAvatarBuffer } from "../avatars";
import { TelegramHistorySync } from "../telegram-history-sync";
import { MediaRecoveryQueue } from "../media-recovery";
import { reuseTelegramPrimarySender } from "../telegram-media-sender";
import { TelegramMediaDownloader } from "../telegram-media-download";
import { telegramSpecialBody } from "../telegram-message-content";
import { nativeMutationId } from "../../src/lib/message-mutations";
import type {
  Adapter,
  AdapterStatus,
  ArchiveChatContext,
  DirectContactContext,
  InboundMessage,
  MediaType,
  OutboundMedia,
  OutboundReaction,
  ResolvedDirectContact,
  SentMessage,
  InboundReaction,
} from "./types";

// GramJS message/entity objects are richly typed; we read a handful of fields
// and its convenience getters (msg.photo, msg.video, ...), so we treat them as
// loose shapes here rather than importing the full Api types.
/* eslint-disable @typescript-eslint/no-explicit-any */

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 25) * 1024 * 1024;
const RECOVERY_MAX_BYTES =
  Number(process.env.MEDIA_RECOVERY_MAX_MB || 250) * 1024 * 1024;

function isRenderableImageFile(filePath: string): boolean {
  try {
    const handle = fs.openSync(filePath, "r");
    try {
      const signature = Buffer.alloc(12);
      if (fs.readSync(handle, signature, 0, signature.length, 0) < 3) return false;
      const ascii = signature.toString("ascii");
      return (
        (signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) ||
        (signature[0] === 0x89 && signature.subarray(1, 4).toString("ascii") === "PNG") ||
        ascii.startsWith("GIF87a") ||
        ascii.startsWith("GIF89a") ||
        (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP")
      );
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}

function contactFrom(chat: any): InboundMessage["contact"] {
  const isGroup = !!chat.title; // groups/supergroups have a title; users don't
  const name =
    chat.title ||
    [chat.firstName, chat.lastName].filter(Boolean).join(" ") ||
    chat.username ||
    "Telegram user";
  const handle = chat.broadcast
    ? "Channel"
    : isGroup
    ? "Group"
    : chat.username
    ? "@" + chat.username
    : chat.phone
    ? "+" + chat.phone
    : String(chat.id);
  return { externalKey: `telegram:${chat.id}`, name, handle };
}

// The forum topic a message belongs to (the topic's root message id).
function topicIdOf(msg: any): number | undefined {
  const rt = msg.replyTo;
  if (!rt) return undefined;
  const id = rt.replyToTopId ?? rt.replyToMsgId;
  return typeof id === "number" ? id : undefined;
}

// Parse a chatExternalId that may encode a forum topic ("<chatId>__t<topicId>").
function parseTarget(chatExternalId: string): { id: number; topicId?: number } {
  const m = /^(-?\d+)__t(\d+)$/.exec(chatExternalId);
  if (m) return { id: Number(m[1]), topicId: Number(m[2]) };
  return { id: Number(chatExternalId) };
}

function resolveMedia(
  msg: any
): {
  type: MediaType;
  ext: string;
  name?: string;
  size: number;
  downloadable: boolean;
  thumb?: boolean;
} | null {
  const file = msg.file;
  const size = Number(file?.size ?? 0);
  const ext = (s: string) => (file?.ext ? String(file.ext).replace(/^\./, "") : s);

  if (msg.photo) return { type: "image", ext: "jpg", size, downloadable: true };
  if (msg.sticker) {
    const mime = String(file?.mimeType || "");
    if (mime.includes("webp"))
      return { type: "sticker", ext: "webp", size, downloadable: true };
    if (mime.includes("webm"))
      return { type: "video", ext: "webm", size, downloadable: true };
    // Animated .tgs can't render in an <img>, but Telegram supplies a static
    // WebP thumbnail that can. Download that instead of the gzipped animation.
    return { type: "sticker", ext: "webp", size, downloadable: true, thumb: true };
  }
  if (msg.videoNote || msg.video || msg.gif)
    return { type: "video", ext: ext("mp4"), size, downloadable: true };
  if (msg.voice || msg.audio)
    return { type: "audio", ext: ext(msg.voice ? "ogg" : "mp3"), size, downloadable: true };
  if (msg.document)
    return {
      type: "file",
      ext: ext("bin"),
      name: file?.name || "file",
      size,
      downloadable: true,
    };
  return null;
}

const MEDIA_LABEL: Record<MediaType, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎙 Voice message",
  sticker: "Sticker",
  file: "📎 File",
};

type TelegramBuildOptions = {
  downloadMedia?: boolean;
  downloadAvatar?: boolean;
  mediaLimitBytes?: number;
  throwMediaErrors?: boolean;
};

export class TelegramAdapter implements Adapter {
  platform = "telegram" as const;
  private client: TelegramClient;
  private state: AdapterStatus["state"] = "starting";
  private detail?: string;
  private reconnectPromise?: Promise<void>;
  // forum channel id -> (topicId -> title), fetched once per channel.
  private senderNames = new Map<string, string>();
  private avatarEntities = new Map<string, any>();
  private forumTopics = new Map<string, Map<number, string>>();
  private onMessage?: (message: InboundMessage) => Promise<void>;
  private onReaction?: (reaction: InboundReaction) => Promise<void>;
  private backgroundPauseUntil = 0;
  private historySync?: TelegramHistorySync;
  private historyTimer?: ReturnType<typeof setInterval>;
  private mediaRecovery = new MediaRecoveryQueue();
  private mediaDownloader = new TelegramMediaDownloader();
  private avatarDownloader = new TelegramMediaDownloader(undefined, 45_000);

  private prioritizeOutbound(): void {
    this.backgroundPauseUntil = Math.max(
      this.backgroundPauseUntil,
      Date.now() + 5000
    );
  }

  private async waitForOutboundPriority(): Promise<void> {
    while (Date.now() < this.backgroundPauseUntil) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, this.backgroundPauseUntil - Date.now()))
      );
    }
  }

  /**
   * Resolve an older, bare numeric Telegram id safely. GramJS treats a
   * positive number as a user id, but this app historically stored groups and
   * channels as the same kind of number. If the entity cache cannot resolve
   * that guess, recover the correctly typed entity from Telegram's dialogs.
   */
  private async resolvePeer(id: number): Promise<any> {
    try {
      return await this.client.getInputEntity(id);
    } catch (originalError) {
      const dialogs = await this.client.getDialogs({ limit: 500 });
      const dialog = dialogs.find((candidate: any) => {
        const entityId = candidate?.entity?.id;
        return entityId != null && String(entityId) === String(Math.abs(id));
      });
      if (!dialog?.entity) throw originalError;
      return this.client.getInputEntity(dialog.entity);
    }
  }

  constructor(private apiId: number, private apiHash: string, session: string, private accountId?: string) {
    this.client = new TelegramClient(
      new StringSession(session),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        // GramJS defaults reconnectRetries to Infinity. During a network
        // outage that can leave thousands of Telegram sockets alive in the
        // shared worker, eventually preventing Chromium (and therefore
        // WhatsApp Web) from spawning at all. Bound the library's internal
        // retry loop; an explicit outbound action can still reconnect later.
        reconnectRetries: 5,
        retryDelay: 1000,
      }
    );
    reuseTelegramPrimarySender(this.client);
  }

  private connectionErrorDetail(error: unknown): string {
    const candidate = error as { errorMessage?: string; message?: string };
    const message = candidate?.errorMessage || candidate?.message || String(error);
    if (message.includes("AUTH_KEY_DUPLICATED")) {
      return "Session invalidated — reconnect Telegram";
    }
    if (message.includes("AUTH_KEY_UNREGISTERED")) {
      return "Session expired — reconnect Telegram";
    }
    return "Connection dropped";
  }

  private async downloadToPublic(
    msg: any,
    messageExternalId: string,
    ext: string,
    // Animated (.tgs) stickers are gzipped Lottie — useless to an <img>. Their
    // thumbnail is a plain image, so grab that instead of showing a text label.
    thumb = false,
    maxBytes = MAX_BYTES
  ): Promise<string | null> {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const filename = `${messageExternalId.replace(/:/g, "_")}.${ext}`;
    const fullPath = path.join(MEDIA_DIR, filename);
    const hasUsableFile =
      fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0 &&
      (!thumb && ext !== "webp" || isRenderableImageFile(fullPath));
    if (!hasUsableFile) {
      const thumbs = (msg.document?.thumbs || msg.media?.document?.thumbs || []).filter(
        (candidate: any) => !(candidate instanceof Api.PhotoPathSize)
      );
      if (thumb && thumbs.length === 0) return null;
      const buf = await this.mediaDownloader.download({
        apiId: this.apiId,
        apiHash: this.apiHash,
        session: String(this.client.session.save()),
        media: msg.media.getBytes(),
        ...(thumb ? { thumb: thumbs.length - 1 } : {}),
        maxBytes,
      });
      if (!Buffer.isBuffer(buf) || !buf.length) return null;
      const temporary = `${fullPath}.${randomUUID()}.part`;
      try {
        fs.writeFileSync(temporary, buf);
        if ((thumb || ext === "webp") && !isRenderableImageFile(temporary)) {
          throw new Error("Telegram did not return a valid sticker image");
        }
        fs.renameSync(temporary, fullPath);
      } finally { fs.rmSync(temporary, { force: true }); }
    }
    return `/media/${filename}`;
  }

  private async avatarFor(chat: any): Promise<string | undefined> {
    const key = `telegram_${chat.id}`;
    const existing = existingAvatar(key);
    if (existing) return existing;
    try {
      const buf = await this.client.downloadProfilePhoto(chat, { isBig: false });
      if (buf && (buf as Buffer).length) return saveAvatarBuffer(key, buf as Buffer);
    } catch {
      /* no photo / privacy */
    }
    return undefined;
  }

  async refreshAvatar(chatExternalId: string, isGroup: boolean, context?: DirectContactContext): Promise<import("./types").AvatarRefreshResult> {
    await this.waitForOutboundPriority();
    const { id } = parseTarget(chatExternalId);
    const exactId = String(Math.abs(id));
    const cachedPeer = (value: number, group: boolean): Api.TypeInputPeer | undefined => {
      const entity = this.avatarEntities.get(String(Math.abs(value)));
      if (entity && Boolean(entity.title) === group) {
        try { return utils.getInputPeer(entity); } catch { /* incomplete entity */ }
      }
      const peers = group
        ? [new Api.PeerChannel({ channelId: bigInt(Math.abs(value)) }), new Api.PeerChat({ chatId: bigInt(Math.abs(value)) })]
        : [new Api.PeerUser({ userId: bigInt(Math.abs(value)) })];
      for (const peer of peers) {
        try {
          // MemorySession tries to cast TL Peer objects directly and throws
          // before consulting its entity cache. Pass the marked numeric ID.
          const markedId = utils.getPeerId(peer);
          const input = this.client.session.getInputEntity(markedId);
          if (utils.getPeerId(input) === markedId) return input;
        } catch { /* not cached */ }
      }
      return undefined;
    };
    let peer = cachedPeer(id, isGroup);
    if (!peer && !isGroup && context?.groupExternalId && context.senderMessageExternalId) {
      const groupId = parseTarget(context.groupExternalId).id;
      const match = /^telegram:(\d+):(\d+)$/.exec(context.senderMessageExternalId);
      const group = cachedPeer(groupId, true);
      if (group && match && match[1] === String(Math.abs(groupId))) {
        peer = new Api.InputPeerUserFromMessage({ peer: group, msgId: Number(match[2]), userId: bigInt(exactId) });
      }
    }
    // A zero-hash user lookup is supported for saved contacts. Never guess a
    // channel type or resolve a similar display name for an unknown group.
    if (!peer && !isGroup) peer = new Api.InputPeerUser({ userId: bigInt(exactId), accessHash: bigInt.zero });
    if (!peer) return { source: "unavailable" };
    const buf = await this.avatarDownloader.download({ apiId: this.apiId, apiHash: this.apiHash,
      session: this.client.session.save() as unknown as string, media: peer.getBytes(),
      profile: { id: exactId, isGroup }, maxBytes: 5_000_000 });
    if (!buf.length) return { source: "unavailable" };
    return { url: saveAvatarBuffer(`telegram_${exactId}`, buf), source: "downloaded" };
  }

  // Fetch a forum channel's topic list (id → title), cached per channel.
  private async ensureForumTopics(chat: any): Promise<void> {
    const chatId = String(chat.id);
    if (this.forumTopics.has(chatId)) return;
    const map = new Map<number, string>();
    this.forumTopics.set(chatId, map); // set first to avoid refetch storms
    try {
      const res: any = await this.client.invoke(
        new Api.channels.GetForumTopics({
          channel: chat,
          limit: 100,
          offsetDate: 0,
          offsetId: 0,
          offsetTopic: 0,
        })
      );
      for (const t of res.topics || []) {
        if (t.id != null && t.title) map.set(Number(t.id), String(t.title));
      }
    } catch {
      /* not a forum / no access */
    }
  }

  /**
   * Display name for a group member. Uses the cached entity when gramjs gives
   * us one, otherwise resolves it once and remembers it — backfill walks
   * thousands of messages and getEntity is a network call.
   */
  private async senderName(senderId: string, cached?: any): Promise<string> {
    const nameOf = (e: any): string =>
      [e?.firstName, e?.lastName].filter(Boolean).join(" ") || e?.username || "";

    const fromCached = nameOf(cached);
    if (fromCached) {
      this.senderNames.set(senderId, fromCached);
      return fromCached;
    }

    const remembered = this.senderNames.get(senderId);
    if (remembered) return remembered;

    try {
      const entity: any = await this.client.getEntity(senderId);
      const resolved = nameOf(entity) || "Member";
      if (resolved !== "Member") this.senderNames.set(senderId, resolved);
      return resolved;
    } catch {
      // Deleted account, or one we can't see — still attribute it to the id so
      // their messages group together instead of falling back to the group.
      // Do not cache this fallback: Telegram's entity cache may simply not be
      // warm yet, and a subsequent message/backfill can resolve the real name.
      return "Member";
    }
  }

  private async buildMessage(
    chat: any,
    msg: any,
    options: TelegramBuildOptions = {}
  ): Promise<InboundMessage> {
    const chatId = String(chat.id);
    const messageExternalId = `telegram:${chatId}:${msg.id}`;
    this.avatarEntities.set(chatId, chat);
    const caption = msg.message && msg.message.length ? msg.message : "";
    const isGroup = !!chat.title;

    const contact = contactFrom(chat);
    contact.avatarUrl =
      options.downloadAvatar === false
        ? existingAvatar(`telegram_${chat.id}`) ?? undefined
        : await this.avatarFor(chat);

    // Forum channels: split into one conversation per topic.
    let chatExternalId = chatId;
    if (chat.forum) {
      const tid = topicIdOf(msg) ?? 1; // no topic info → General (id 1)
      await this.ensureForumTopics(chat);
      const tname =
        this.forumTopics.get(chatId)?.get(tid) ||
        (tid === 1 ? "General" : `Topic ${tid}`);
      chatExternalId = `${chatId}__t${tid}`;
      contact.externalKey = `telegram:${chatExternalId}`;
      contact.name = `${chat.title} · ${tname}`;
      contact.handle = "Topic";
    }

    const rawTimestamp = Number(msg.date);
    const parsedTimestamp = new Date(
      rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000
    );
    // Telegram service messages can occasionally arrive without a usable
    // date. Keep them importable without making an ancient malformed row look
    // like a brand-new inbox message.
    const timestamp = Number.isNaN(parsedTimestamp.getTime())
      ? new Date(0)
      : parsedTimestamp;

    const base: InboundMessage = {
      platform: "telegram",
      chatExternalId,
      messageExternalId,
      direction: msg.out ? "out" : "in",
      body: caption,
      timestamp,
      contact,
      isGroup,
      mentionsMe: isGroup && !msg.out && Boolean(msg.mentioned),
    };

    const replyHeader = msg.replyTo;
    const repliedMessageId = Number(replyHeader?.replyToMsgId || 0);
    const topicRootId = Number(replyHeader?.replyToTopId || 0);
    const isTopicRoutingOnly =
      Boolean(replyHeader?.forumTopic) &&
      repliedMessageId > 0 &&
      repliedMessageId === topicRootId &&
      !replyHeader?.quote;
    if (repliedMessageId > 0 && !isTopicRoutingOnly) {
      base.replyToExternalKey = `telegram:${chatId}:${repliedMessageId}`;
      if (replyHeader?.quoteText) {
        base.replyPreview = String(replyHeader.quoteText);
      }
    }

    // In groups, attribute inbound messages to their sender (for member tags).
    // Broadcast channels post as the channel itself, so no per-member sender.
    //
    // msg.sender is lazily populated by gramjs — it is only set when that user's
    // entity happens to be cached. Relying on it alone silently dropped the
    // sender on a chunk of messages, and an unattributed group message renders
    // as the group itself, so one person appeared to be two. Fall back to the
    // id fields, which are always present, and resolve the name separately.
    if (isGroup && !msg.out && !chat.broadcast) {
      const cached: any = msg.sender;
      const senderId =
        cached?.id ?? msg.senderId ?? msg.fromId?.userId ?? msg.fromId?.channelId;
      if (senderId != null) {
        let senderEntity = cached;
        if (!senderEntity) {
          try {
            // getSender() can use the access hash attached to the message even
            // when getEntity(id) cannot yet build an input peer.
            senderEntity = await msg.getSender();
          } catch {
            try {
              senderEntity = await this.client.getEntity(String(senderId));
            } catch {
              /* deleted/private account */
            }
          }
        }
        base.sender = {
          externalKey: `telegram:${senderId}`,
          name: await this.senderName(String(senderId), senderEntity),
          avatarUrl: senderEntity
            ? options.downloadAvatar === false
              ? existingAvatar(`telegram_${senderEntity.id}`) ?? undefined
              : await this.avatarFor(senderEntity)
            : undefined,
        };
        if (senderEntity) this.avatarEntities.set(String(senderId), senderEntity);
      }
    }

    const resolved = resolveMedia(msg);
    if (resolved?.type === "sticker" && !caption) {
      // DocumentAttributeSticker.alt is the emoji the sticker represents. Far
      // more informative than the word "Sticker" when the art can't render.
      const alt = (msg.sticker?.attributes || []).find(
        (a: any) => typeof a?.alt === "string" && a.alt
      )?.alt;
      if (alt) base.body = alt;
    }
    if (resolved) {
      let url: string | null = null;
      if (
        options.downloadMedia !== false &&
        resolved.downloadable &&
        (resolved.thumb || resolved.size <= (options.mediaLimitBytes ?? MAX_BYTES))
      ) {
        url = await this.downloadToPublic(
          msg,
          messageExternalId,
          resolved.ext,
          resolved.thumb,
          options.mediaLimitBytes ?? MAX_BYTES
        ).catch(error => { if (options.throwMediaErrors) throw error; return null; });
      }
      base.media = { type: resolved.type, url, name: resolved.name,
        isGif: Boolean(msg.gif || (msg.sticker && resolved.type === "video")) };
    } else if (!caption) {
      base.body = telegramSpecialBody(msg, base.sender?.name);
    }

    return base;
  }

  /**
   * Telegram updates include the ID of the message being replied to, but that
   * message may sit far outside the bounded history window we sync. Pull the
   * exact target while we still have the native Telegram message so reply
   * previews and click-to-jump work without a manual deep backfill.
   */
  private async buildReplyTarget(
    chat: any,
    msg: any,
    current: InboundMessage,
    options: TelegramBuildOptions
  ): Promise<InboundMessage | null> {
    if (!current.replyToExternalKey) return null;

    const repliedMessageId = Number(msg.replyTo?.replyToMsgId || 0);
    if (!Number.isFinite(repliedMessageId) || repliedMessageId <= 0) return null;

    let target: any;
    try {
      target =
        typeof msg.getReplyMessage === "function"
          ? await msg.getReplyMessage()
          : undefined;
    } catch {
      // Some older cached messages cannot resolve their reply through the
      // convenience getter. The exact-ID fetch below uses the current chat.
    }
    if (!target) {
      const fetched = await this.client
        .getMessages(chat, { ids: [repliedMessageId] })
        .catch(() => [] as any[]);
      target = fetched.find((candidate: any) => candidate?.id != null);
    }
    if (!target || Number(target.id) !== repliedMessageId) return null;

    const replyTarget = await this.buildMessage(chat, target, {
      ...options,
      // The current chat already supplied its avatar. Avoid repeating that
      // network work for an older message referenced by a reply.
      downloadAvatar: false,
    });

    // A forum reply target can be a topic root whose own Telegram payload does
    // not carry topic routing. Keep it beside the reply so focus navigation can
    // find it in the same conversation.
    if (chat.forum) {
      replyTarget.chatExternalId = current.chatExternalId;
      replyTarget.contact = { ...current.contact };
    }
    replyTarget.historical = true;
    return replyTarget;
  }

  private replyPreviewFor(message: InboundMessage): string {
    const text = message.body.trim();
    if (text && text !== "[unsupported message]") return text;
    return message.media ? MEDIA_LABEL[message.media.type] : "Message";
  }

  /** Persist the referenced message first, then the reply itself. */
  private async ingestMessage(
    chat: any,
    msg: any,
    onMessage: (m: InboundMessage) => Promise<void>,
    options: TelegramBuildOptions = {},
    historical = false
  ): Promise<InboundMessage> {
    const current = await this.buildMessage(chat, msg, options);
    const replyTarget = await this.buildReplyTarget(chat, msg, current, options);
    if (replyTarget) {
      current.replyPreview ||= this.replyPreviewFor(replyTarget);
      current.replySender ||=
        replyTarget.direction === "out"
          ? "You"
          : replyTarget.sender?.name || replyTarget.contact.name;
      await onMessage(replyTarget);
    }
    current.historical = historical;
    await onMessage(current);
    return current;
  }

  getStatus(): AdapterStatus {
    // GramJS reconnects internally, but its update loop can lose the socket
    // while our last explicit state is still "ready". Never advertise a dead
    // transport as sendable.
    if (this.state === "ready" && !this.client.connected) this.state = "starting";
    return { platform: "telegram", state: this.state, detail: this.detail, sync: this.historySync?.getStatus() };
  }

  async ensureReady(): Promise<void> {
    if (this.client.connected) {
      this.state = "ready";
      return;
    }
    if (!this.reconnectPromise) {
      this.state = "starting";
      this.reconnectPromise = this.client
        .connect()
        .then(() => {
          if (!this.client.connected) throw new Error("Telegram did not reconnect");
          this.state = "ready";
        })
        .catch((error) => {
          this.state = "disconnected";
          this.detail = this.connectionErrorDetail(error);
          throw error;
        })
        .finally(() => {
          this.reconnectPromise = undefined;
        });
    }
    return this.reconnectPromise;
  }

  async recover(): Promise<void> {
    if (this.reconnectPromise) return this.reconnectPromise;
    this.state = "starting";
    await this.client.disconnect().catch(() => {});
    await this.ensureReady();
  }

  /**
   * Pull the reactions off a fetched message. Telegram gives per-actor detail
   * in `recentReactions` for small chats, and only totals in `results` once a
   * chat gets big — so we emit whichever is available.
   */
  private reactionFrom(chatId: string, msg: any): InboundReaction | null {
    const r = msg?.reactions;
    if (!r) return null;
    const messageExternalId = `telegram:${chatId}:${msg.id}`;
    const emojiOf = (re: any): string =>
      re?.emoticon || (re?.documentId ? `custom:${re.documentId}` : "");

    const recent: any[] = r.recentReactions || [];
    if (recent.length) {
      // One actor per event; the store replaces that actor's whole set.
      const byActor = new Map<string, string[]>();
      for (const rr of recent) {
        const uid = rr?.peerId?.userId ?? rr?.peerId?.chatId ?? rr?.peerId?.channelId;
        const emoji = emojiOf(rr?.reaction);
        if (uid == null || !emoji) continue;
        const key = `telegram:${uid}`;
        byActor.set(key, [...(byActor.get(key) || []), emoji]);
      }
      const first = [...byActor.entries()][0];
      if (first) {
        return {
          platform: "telegram",
          messageExternalId,
          actor: { externalKey: first[0] },
          emojis: first[1],
        };
      }
    }

    const counts = (r.results || [])
      .map((x: any) => ({ emoji: emojiOf(x?.reaction), count: Number(x?.count) || 0 }))
      .filter((x: { emoji: string }) => x.emoji);
    if (!counts.length) return null;
    return {
      platform: "telegram",
      messageExternalId,
      actor: { externalKey: "aggregate" },
      counts,
    };
  }

  async start(
    onMessage: (m: InboundMessage) => Promise<void>,
    onRead?: (chatExternalId: string) => Promise<void>,
    onReaction?: (r: InboundReaction) => Promise<void>
  ): Promise<void> {
    await this.ensureReady();
    this.onMessage = onMessage;
    this.onReaction = onReaction;

    // Register live handlers before starting history import. Backfill can take
    // a long time when chats contain media; live DMs must never wait behind it.
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const msg: any = event.message;
        if (!msg.isPrivate && !msg.isGroup && !msg.isChannel) return; // DMs + groups + channels
        const chat = await msg.getChat();
        if (!chat) return;
        await this.ingestMessage(chat, msg, onMessage, { downloadMedia: false, downloadAvatar: false });
      } catch (e) {
        console.error("[telegram] handler error:", e);
      }
    }, new NewMessage({}));

    // Read-state sync: Telegram pushes UpdateReadHistoryInbox when you read a
    // chat on another device, so we can clear the unread badge here.
    if (onRead) {
      this.client.addEventHandler((update: any) => {
        if (update?.className !== "UpdateReadHistoryInbox") return;
        const peer = update.peer;
        const uid = peer?.userId ?? peer?.chatId ?? peer?.channelId;
        if (uid != null) onRead(String(uid)).catch(() => {});
      });
    }

    const me: any = await this.client.getMe();
    this.detail = me?.username ? "@" + me.username : "account";
    console.log(`[telegram] live as ${this.detail}`);

    // Live reactions. Telegram pushes UpdateMessageReactions with the current
    // state for that message, so we forward it as-is and let the store replace.
    if (onReaction) {
      this.client.addEventHandler((update: any) => {
        if (update?.className !== "UpdateMessageReactions") return;
        try {
          const peer = update.peer;
          const chatId = String(
            peer?.userId ?? peer?.chatId ?? peer?.channelId ?? ""
          );
          if (!chatId) return;
          const r = this.reactionFrom(chatId, {
            id: update.msgId,
            reactions: update.reactions,
          });
          if (r) onReaction(r).catch(() => {});
        } catch (e) {
          console.error("[telegram] reaction handler error:", e);
        }
      });
    }

    // Continuous catch-up is independent of the optional expensive startup
    // import. The launcher disables that import, not durable message storage.
    if (this.accountId) {
      this.historySync?.stop();
      if (this.historyTimer) clearInterval(this.historyTimer);
      const knownDialogs = new Map<string, { id: string; latestId: number; entity: unknown }>();
      let fullDiscoveryAt = 0;
      this.historySync = new TelegramHistorySync({
        file: path.join(process.env.DATA_DIR || process.cwd(), ".chat-history", `telegram-${this.accountId}.json`),
        list: async () => {
          const full = Date.now() - fullDiscoveryAt >= 24 * 60 * 60_000;
          const dialogs = await this.client.getDialogs(full ? {} : { limit: 100 });
          for (const d of dialogs) if (d.entity && (d.isUser || d.isGroup || d.isChannel)) {
            // Include the peer kind: user and channel numeric IDs can overlap.
            const id = `${d.entity.className}:${String(d.entity.id)}`;
            knownDialogs.set(id, { id, latestId: Number((d as any).message?.id || 0), entity: d.entity });
          }
          if (full) fullDiscoveryAt = Date.now();
          return [...knownDialogs.values()];
        },
        fetch: async (entity, options) => this.client.getMessages(entity as any, options) as any,
        save: async (entity, message) => { await this.ingestMessage(entity, message, onMessage, { downloadAvatar: false, downloadMedia: false }, true); },
        ready: () => Boolean(this.onMessage && this.client.connected && this.state === "ready"),
        beforePage: () => this.waitForOutboundPriority(),
      });
      const catchUp = () => { void this.historySync?.run().catch(e => console.error("[telegram] automatic history error:", e)); };
      catchUp();
      this.historyTimer = setInterval(catchUp, 5 * 60_000);
      this.historyTimer.unref?.();
    }
    if (process.env.SYNC_BACKFILL !== "0" && !this.accountId) {
      void this.backfill(onMessage, onReaction).catch((e) =>
        console.error("[telegram] backfill error:", e)
      );
    }
  }

  private async backfill(
    onMessage: (m: InboundMessage) => Promise<void>,
    onReaction?: (r: InboundReaction) => Promise<void>
  ): Promise<void> {
    // Startup should discover chats, not repeatedly deep-import thousands of
    // messages. Deep history remains available through the chat's Backfill
    // button and can be restored at startup explicitly when needed.
    const deepStartupBackfill =
      process.env.SYNC_STARTUP_DEEP_BACKFILL === "1";
    const richDialogLimit = deepStartupBackfill
      ? Number(process.env.SYNC_BACKFILL_DIALOGS || 30)
      : 0;
    const discoveryDialogLimit = Math.max(
      richDialogLimit,
      Number(process.env.SYNC_DISCOVERY_DIALOGS || 500)
    );
    const msgLimit = Number(process.env.SYNC_BACKFILL_MESSAGES || 20);
    // A live update can be missed while the worker is stopped or reconnecting.
    // Reconcile a small recent window for active dialogs at startup instead of
    // importing only each dialog's final message, which left invisible holes
    // between two messages that were already present in Omni.
    const recentRepairDialogLimit = Math.max(
      richDialogLimit,
      Number(process.env.SYNC_RECENT_REPAIR_DIALOGS || 50)
    );
    const recentRepairMessageLimit = Math.max(
      2,
      Math.min(25, Number(process.env.SYNC_RECENT_REPAIR_MESSAGES || 10))
    );
    const mediaDialogLimit = deepStartupBackfill
      ? Math.max(0, Number(process.env.SYNC_BACKFILL_MEDIA_DIALOGS || 10))
      : 0;
    const dialogs = await this.client.getDialogs({ limit: discoveryDialogLimit });
    let count = 0;
    let failed = 0;
    const topicMsgLimit = Number(process.env.SYNC_BACKFILL_TOPIC_MESSAGES || 15);
    const topicCap = Number(process.env.SYNC_BACKFILL_TOPICS || 25);
    const indexedDialogs = dialogs.map((dialog, dialogIndex) => ({
      dialog,
      dialogIndex,
    }));
    // Discover older dialogs before doing expensive forum/media history for
    // the newest ones. Live events already cover current chats; this ordering
    // makes missing or long-idle chats appear in the CRM much sooner.
    const work = [
      ...indexedDialogs.slice(richDialogLimit),
      ...indexedDialogs.slice(0, richDialogLimit),
    ];
    for (const [processedIndex, { dialog: d, dialogIndex }] of work.entries()) {
      await this.waitForOutboundPriority();
      if (!(d.isUser || d.isGroup || d.isChannel) || !d.entity) continue;
      const chat: any = d.entity;
      const ingest = async (msgs: any[]) => {
        for (const msg of [...msgs].reverse()) {
          if (!msg) continue;
          await this.waitForOutboundPriority();
          try {
            await this.ingestMessage(
              chat,
              msg,
              onMessage,
              {
                downloadMedia: false,
                downloadAvatar: dialogIndex < richDialogLimit,
              },
              true
            );
            // Fetched messages carry their current reactions — this is the only
            // platform where history can be recovered rather than watched for.
            if (onReaction) {
              const chatId = String(chat.id);
              const r = this.reactionFrom(chatId, msg);
              if (r) await onReaction(r).catch(() => {});
            }
            count++;
          } catch (error) {
            failed++;
            console.error(
              `[telegram] skipped backfill message ${String(chat.id)}:${String(msg.id)}`,
              error
            );
          }
        }
      };
      try {
        if (chat.forum && dialogIndex < richDialogLimit) {
          // Deep-sync topics only for recent dialogs. Older forums still get a
          // lightweight timeline fetch below so the channel remains discoverable.
          await this.ensureForumTopics(chat);
          const topicIds = [...(this.forumTopics.get(String(chat.id))?.keys() ?? [])]
            .slice(0, topicCap);
          for (const tid of topicIds) {
            const msgs = await this.client
              .getMessages(chat, { limit: topicMsgLimit, replyTo: tid })
              .catch(() => [] as any[]);
            await ingest(msgs);
          }
          await ingest(
            await this.client.getMessages(chat, { limit: msgLimit }).catch(() => [])
          );
        } else {
          if (dialogIndex >= richDialogLimit) {
            // Recent active dialogs receive a bounded repair window so any
            // updates missed during downtime are recovered. Older dialogs use
            // their embedded latest message, avoiding hundreds of extra
            // GetHistory requests and Telegram flood waits.
            const latestMessage = (d as any).message;
            await ingest(
              dialogIndex < recentRepairDialogLimit
                ? await this.client.getMessages(chat, {
                    limit: recentRepairMessageLimit,
                  })
                : latestMessage
                ? [latestMessage]
                : await this.client.getMessages(chat, { limit: 1 })
            );
          } else {
            await ingest(
              await this.client.getMessages(chat, { limit: msgLimit })
            );
          }
        }
      } catch (error) {
        failed++;
        console.error(
          `[telegram] skipped backfill dialog ${String(chat.id)}`,
          error
        );
      }
      if ((processedIndex + 1) % 50 === 0) {
        console.log(
          `[telegram] backfill progress ${processedIndex + 1}/${dialogs.length} dialogs, ` +
            `${count} messages, ${failed} skipped`
        );
      }
    }
    console.log(
      `[telegram] backfilled ${count} messages from ${dialogs.length} dialogs ` +
        `(${Math.min(richDialogLimit, dialogs.length)} deep, ` +
        `${Math.max(0, dialogs.length - richDialogLimit)} discovery, ${failed} skipped)`
    );
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    _mentions?: string[],
    replyToExternalId?: string
  ): Promise<SentMessage> {
    // Pause history discovery before touching the live transport. This keeps
    // an outgoing message ahead of hundreds of startup history operations.
    this.prioritizeOutbound();
    await this.ensureReady();
    // Telegram ids are well within Number's safe-integer range. A forum topic
    // target is "<chatId>__t<topicId>" — post into the topic via replyTo.
    const { id, topicId } = parseTarget(chatExternalId);
    const peer = await this.resolvePeer(id);
    const nativeReplyId = replyToExternalId
      ? Number(replyToExternalId.split(":").at(-1))
      : undefined;
    const replyTo = nativeReplyId || (topicId && topicId !== 1 ? topicId : undefined);
    try {
      let sent: any;
      if (media) {
        // forceDocument keeps arbitrary files as documents instead of trying to
        // render them as photos/videos.
        sent = await this.client.sendFile(peer, {
          file: media.path,
          caption: body || undefined,
          forceDocument: media.type === "file",
          replyTo,
        });
      } else {
        sent = await this.client.sendMessage(peer, { message: body, replyTo });
      }
      return {
        messageExternalId: `telegram:${chatExternalId}:${sent.id}`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.state = "starting";
      void this.recover().catch((reconnectError) =>
        console.error("[telegram] recovery failed:", reconnectError)
      );
      throw error;
    }
  }

  private async mutationTarget(chatExternalId: string, messageExternalId: string) {
    this.prioritizeOutbound();
    await this.ensureReady();
    const nativeId = Number(nativeMutationId("telegram", chatExternalId, messageExternalId));
    if (!Number.isSafeInteger(nativeId) || nativeId <= 0) throw new Error("Telegram message ID is invalid.");
    const { id, topicId } = parseTarget(chatExternalId);
    const peer = await this.resolvePeer(id);
    const [message] = await this.client.getMessages(peer, { ids: [nativeId] });
    // Telegram's getMessages(ids) can ignore a non-channel peer. Check it here
    // before deleteMessages, whose ordinary-chat IDs are account-wide.
    if (!message?.out || !message.peerId || utils.getPeerId(message.peerId) !== utils.getPeerId(peer) ||
        (topicId && topicId !== 1 && topicIdOf(message) !== topicId)) {
      throw new Error("Telegram could not verify your original message in this chat.");
    }
    return { peer, nativeId };
  }

  async editMessage(chatExternalId: string, messageExternalId: string, body: string): Promise<void> {
    const { peer, nativeId } = await this.mutationTarget(chatExternalId, messageExternalId);
    // No Markdown parsing: save exactly what the editor shows, including links.
    await this.client.editMessage(peer, { message: nativeId, text: body, formattingEntities: [] });
  }

  async deleteMessage(chatExternalId: string, messageExternalId: string): Promise<void> {
    const { peer, nativeId } = await this.mutationTarget(chatExternalId, messageExternalId);
    await this.client.deleteMessages(peer, [nativeId], { revoke: true });
  }

  async react(
    chatExternalId: string,
    messageExternalId: string,
    reaction: OutboundReaction
  ): Promise<void> {
    await this.ensureReady();
    const { id } = parseTarget(chatExternalId);
    const peer = await this.resolvePeer(id);
    const msgId = Number(messageExternalId.split(":").at(-1));
    if (!Number.isFinite(msgId)) throw new Error("Telegram message ID is invalid");
    await this.client.invoke(
      new Api.messages.SendReaction({
        peer,
        msgId,
        reaction: reaction.remove
          ? []
          : [new Api.ReactionEmoji({ emoticon: reaction.emoji })],
        addToRecent: !reaction.remove,
      })
    );
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
    await this.ensureReady();
    const participants = participantKeys
      .map((participantKey) => ({
        participantKey,
        id: Number(participantKey.replace(/^telegram:/, "")),
      }))
      .filter((participant) => !Number.isNaN(participant.id));
    if (!participants.length) throw new Error("no Telegram participants");

    const resolved: { participantKey: string; user: any }[] = [];
    const outcomes = new Map<
      string,
      {
        participantKey: string;
        status: "added" | "invite_sent" | "not_added";
        detail?: string;
      }
    >();
    for (const participant of participants) {
      try {
        resolved.push({
          participantKey: participant.participantKey,
          user: await this.client.getInputEntity(participant.id),
        });
      } catch (e) {
        console.error(
          `[telegram] createGroup: can't resolve user ${participant.id}:`,
          e
        );
        outcomes.set(participant.participantKey, {
          participantKey: participant.participantKey,
          status: "not_added",
          detail: "Telegram could not find this person to add or message them.",
        });
      }
    }
    if (!resolved.length) throw new Error("couldn't resolve any participants");

    // Telegram can reject one member because of their privacy settings. Start
    // with one working member, then add the rest individually so a single
    // rejection does not prevent the group from being created.
    let res: any;
    let anchorIndex = -1;
    let lastCreateError: unknown;
    for (let index = 0; index < resolved.length; index += 1) {
      try {
        res = await this.client.invoke(
          new Api.messages.CreateChat({
            users: [resolved[index].user],
            title: name,
          })
        );
        anchorIndex = index;
        break;
      } catch (error) {
        lastCreateError = error;
        console.warn(
          `[telegram] couldn't use ${resolved[index].participantKey} as the initial group member:`,
          error
        );
      }
    }
    if (!res || anchorIndex < 0) {
      throw lastCreateError || new Error("Telegram couldn't create the group");
    }
    // The new chat is in the returned updates; shapes vary across layers.
    const chats: any[] = res?.updates?.chats || res?.chats || [];
    const chat = chats.find((c) => c?.id != null);
    if (!chat) {
      console.error(
        "[telegram] createGroup: no chat in response:",
        JSON.stringify(res).slice(0, 400)
      );
      throw new Error("group created but its id wasn't in the response");
    }

    const failedToAdd: { participantKey: string; user: any; detail: string }[] = [];
    for (let index = 0; index < resolved.length; index += 1) {
      const participant = resolved[index];
      if (index === anchorIndex) {
        outcomes.set(participant.participantKey, {
          participantKey: participant.participantKey,
          status: "added",
        });
        continue;
      }
      try {
        await this.client.invoke(
          new Api.messages.AddChatUser({
            chatId: chat.id,
            userId: participant.user,
            fwdLimit: 0,
          })
        );
        outcomes.set(participant.participantKey, {
          participantKey: participant.participantKey,
          status: "added",
        });
      } catch (error) {
        console.warn(
          `[telegram] couldn't add ${participant.participantKey}; will try a private invite:`,
          error
        );
        failedToAdd.push({
          ...participant,
          detail: "Telegram's privacy settings prevented a direct add.",
        });
      }
    }

    let inviteUrl: string | undefined;
    if (failedToAdd.length) {
      try {
        const invite: any = await this.client.invoke(
          new Api.messages.ExportChatInvite({
            peer: new Api.InputPeerChat({ chatId: chat.id }),
          })
        );
        inviteUrl = invite?.link;
      } catch (error) {
        console.error("[telegram] couldn't create a fallback group invite:", error);
      }
    }

    for (const participant of failedToAdd) {
      let sent = false;
      if (inviteUrl) {
        try {
          await this.client.sendMessage(participant.user, {
            message: `I couldn't add you to “${name}” directly, so here is the group link: ${inviteUrl}`,
          });
          sent = true;
        } catch (error) {
          console.error(
            `[telegram] couldn't send group invite to ${participant.participantKey}:`,
            error
          );
        }
      }
      outcomes.set(participant.participantKey, {
        participantKey: participant.participantKey,
        status: sent ? "invite_sent" : "not_added",
        detail: sent
          ? "Group link sent in a private Telegram message."
          : `${participant.detail} The invite could not be delivered.`,
      });
    }

    return {
      chatExternalId: String(chat.id),
      inviteUrl,
      participantOutcomes: participantKeys.map(
        (participantKey) =>
          outcomes.get(participantKey) || {
            participantKey,
            status: "not_added" as const,
            detail: "Telegram could not add or invite this person.",
          }
      ),
    };
  }

  async resolveDirectContact(target: string): Promise<ResolvedDirectContact> {
    await this.ensureReady();
    const value = target
      .trim()
      .replace(/^telegram:/i, "")
      .replace(/^https?:\/\/(?:www\.)?t\.me\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    if (!value) throw new Error("Enter a Telegram username.");

    let entity: any;
    try {
      entity = await this.client.getEntity(value);
    } catch {
      throw new Error("Telegram could not find that exact username.");
    }
    if (!entity?.id || entity?.title || entity?.broadcast) {
      throw new Error("That Telegram recipient is not a person you can message.");
    }
    const contact = contactFrom(entity);
    return {
      chatExternalId: String(entity.id),
      externalKey: contact.externalKey,
      name: contact.name,
      handle: contact.handle,
    };
  }

  async markRead(chatExternalId: string): Promise<void> {
    const peer = await this.resolvePeer(parseTarget(chatExternalId).id);
    await this.client.invoke(
      new Api.messages.ReadHistory({ peer, maxId: 0 })
    );
  }

  async setArchivedAndMuted(
    chatExternalId: string,
    archived: boolean,
    _context?: ArchiveChatContext
  ): Promise<void> {
    await this.ensureReady();
    const peer = await this.resolvePeer(parseTarget(chatExternalId).id);
    const setMuted = (muted: boolean) =>
      this.client.invoke(
        new Api.account.UpdateNotifySettings({
          peer: new Api.InputNotifyPeer({ peer }),
          settings: new Api.InputPeerNotifySettings({
            // Telegram's maximum signed timestamp is its conventional
            // "forever" mute. Zero restores normal notifications.
            muteUntil: muted ? 2_147_483_647 : 0,
          }),
        })
      );
    const setArchived = (value: boolean) =>
      this.client.invoke(
        new Api.folders.EditPeerFolders({
          folderPeers: [
            new Api.InputFolderPeer({ peer, folderId: value ? 1 : 0 }),
          ],
        })
      );

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
    _oldestTimestamp: number,
    count = 100,
    context?: { isGroup?: boolean; sinceTimestamp?: number }
  ): Promise<void> {
    if (!this.onMessage) throw new Error("Telegram is not ready");

    const { id, topicId } = parseTarget(chatExternalId);
    let peer: any;
    try {
      peer = await this.resolvePeer(id);
    } catch (error) {
      // Older basic Telegram groups need no access hash, but a bare positive
      // numeric ID is otherwise interpreted as a user. The CRM knows this is
      // a group, so recover it with the correctly typed peer after the normal
      // entity-cache/dialog lookup has failed.
      if (!context?.isGroup || id <= 0) throw error;
      peer = new Api.InputPeerChat({ chatId: bigInt(id) });
    }
    const chat: any = await this.client.getEntity(peer);
    const nativeOldestId = Number(oldestMessageId.split(":").at(-1));
    const limit = Math.max(1, Math.min(count, 500));
    const topicOptions =
      topicId && topicId !== 1 ? { replyTo: topicId } : {};
    const hasOldest = Number.isFinite(nativeOldestId) && nativeOldestId > 0;

    // Reconcile the newest window on every manual backfill. Fetching only
    // before the oldest stored ID can extend history, but can never fill a
    // recent hole between two rows already in the database.
    const recentLimit = context?.sinceTimestamp
      ? Math.min(500, Math.max(limit, 200))
      : hasOldest
        ? Math.min(50, limit)
        : limit;
    const fetchMessages = async (options: Record<string, unknown>) => {
      try {
        return await this.client.getMessages(chat, {
          ...options,
          ...topicOptions,
        });
      } catch (error) {
        // Telegram occasionally leaves messages tagged with an old forum topic
        // root after that topic can no longer be queried through GetReplies.
        // Fall back to the parent chat and keep only messages that still carry
        // the requested topic id so a rolling repair does not fail completely.
        if (!topicId || !/TOPIC_ID_INVALID/i.test(String(error))) throw error;
        const fallback = await this.client.getMessages(chat, options);
        return fallback.filter((message: any) => topicIdOf(message) === topicId);
      }
    };
    const fetchedRecentMessages = await fetchMessages({ limit: recentLimit });
    const recentMessages = context?.sinceTimestamp
      ? fetchedRecentMessages.filter((message: any) => {
          const raw = Number(message?.date || 0);
          const timestamp = raw > 1_000_000_000_000 ? raw : raw * 1000;
          return timestamp >= context.sinceTimestamp!;
        })
      : fetchedRecentMessages;
    const olderLimit = context?.sinceTimestamp
      ? 0
      : hasOldest
        ? Math.max(0, limit - recentLimit)
        : 0;
    const olderMessages = olderLimit
      ? await fetchMessages({
          limit: olderLimit,
          offsetId: nativeOldestId,
        })
      : [];
    const messagesById = new Map<string, any>();
    for (const message of [...recentMessages, ...olderMessages]) {
      if (message?.id != null) messagesById.set(String(message.id), message);
    }
    const messages = [...messagesById.values()].sort(
      (a, b) =>
        Number(a.date || 0) - Number(b.date || 0) ||
        Number(a.id || 0) - Number(b.id || 0)
    );

    let imported = 0;
    for (const message of messages) {
      if (!message) continue;
      await this.ingestMessage(
        chat,
        message,
        this.onMessage,
        context?.sinceTimestamp
          ? {
              // A whole-inbox repair should not download hundreds of avatars
              // and attachments serially. Preserve attachment metadata; the
              // user can recover an individual binary from its message card.
              downloadAvatar: false,
              downloadMedia: false,
            }
          : {},
        true
      );
      if (this.onReaction) {
        const reaction = this.reactionFrom(String(chat.id), message);
        if (reaction) await this.onReaction(reaction).catch(() => {});
      }
      imported++;
    }
    console.log(
      `[telegram] requested ${imported} older messages for ${chatExternalId}`
    );
  }

  async recoverMedia(
    chatExternalId: string,
    messageExternalId: string,
    options?: { automatic?: boolean }
  ): Promise<void> {
    return this.mediaRecovery.run(messageExternalId, !!options?.automatic,
      () => this.recoverMediaNow(chatExternalId, messageExternalId, options));
  }

  private async recoverMediaNow(
    chatExternalId: string,
    messageExternalId: string,
    options?: { automatic?: boolean }
  ): Promise<void> {
    if (!this.onMessage) throw new Error("Telegram is not ready");
    await this.waitForOutboundPriority();
    await this.ensureReady();

    const { id } = parseTarget(chatExternalId);
    const peer = await this.resolvePeer(id);
    const chat: any = await this.client.getEntity(peer);
    const nativeMessageId = Number(messageExternalId.split(":").at(-1));
    if (!Number.isFinite(nativeMessageId) || nativeMessageId <= 0) {
      throw new Error("Telegram message ID is invalid");
    }

    const messages = await this.client.getMessages(chat, {
      ids: [nativeMessageId],
    });
    const message = messages.find(Boolean);
    if (!message) throw new Error("Telegram no longer provides this message");

    const media = resolveMedia(message);
    const mediaLimit = options?.automatic ? MAX_BYTES : RECOVERY_MAX_BYTES;
    if (media && !media.thumb && media.size > mediaLimit) {
      throw new Error(
        `This attachment is larger than the ${Math.round(
          mediaLimit / 1024 / 1024
        )} MB ${options?.automatic ? "automatic download" : "manual recovery"} limit`
      );
    }

    const recovered = await this.buildMessage(chat, message, {
      downloadMedia: true,
      downloadAvatar: false,
      mediaLimitBytes: mediaLimit,
      throwMediaErrors: true,
    });
    if (!recovered.media?.url) {
      throw new Error(
        recovered.media
          ? "Telegram could not download this attachment"
          : "Telegram did not include a playable attachment"
      );
    }
    recovered.historical = true;
    await this.onMessage(recovered);
  }

  async stop(): Promise<void> {
    this.historySync?.stop();
    if (this.historyTimer) clearInterval(this.historyTimer);
    this.historyTimer = undefined;
    this.onMessage = undefined;
    this.onReaction = undefined;
    await this.mediaDownloader.stop();
    await this.avatarDownloader.stop();
    await this.client.disconnect();
  }
}

export { MEDIA_LABEL };
