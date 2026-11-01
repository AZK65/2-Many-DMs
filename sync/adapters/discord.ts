import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { extFromMime, saveMediaStream, MAX_BYTES } from "../media";
import WebSocket, { type RawData } from "ws";
import { nativeMutationId } from "../../src/lib/message-mutations";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  InboundReaction,
  OutboundMedia,
  OutboundReaction,
  SentMessage,
} from "./types";

const API_BASE = "https://discord.com/api/v10";
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
};

type DiscordChannel = {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
  recipients?: DiscordUser[];
};

type DiscordAttachment = {
  id: string;
  filename: string;
  content_type?: string | null;
  url: string;
  proxy_url?: string;
};

type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  timestamp: string;
  author: DiscordUser;
  member?: { nick?: string | null; avatar?: string | null };
  mentions?: DiscordUser[];
  attachments?: DiscordAttachment[];
  embeds?: Array<{ title?: string; description?: string }>;
  sticker_items?: Array<{ id: string; name: string }>;
  message_reference?: { message_id?: string; channel_id?: string };
  referenced_message?: DiscordMessage | null;
};

type GatewayPacket = {
  op: number;
  // Gateway dispatches vary widely; each handler narrows the fields it uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d: any;
  s?: number | null;
  t?: string | null;
};

type ChannelMeta = DiscordChannel & {
  guildName?: string;
  guildIcon?: string | null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanToken(value: string): string {
  return value.trim().replace(/^Bot\s+/i, "");
}

function messageKey(channelId: string, messageId: string): string {
  return `discord:${channelId}:${messageId}`;
}

function messageIdFromKey(value: string): string | undefined {
  const match = value.match(/^discord:\d+:(\d+)$/);
  return match?.[1];
}

function userName(user?: DiscordUser, fallback = "Discord member"): string {
  return user?.global_name || user?.username || fallback;
}

function userAvatar(user?: DiscordUser): string | undefined {
  if (!user?.id || !user.avatar) return undefined;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

function mediaType(contentType?: string | null): "image" | "video" | "audio" | "file" {
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.startsWith("video/")) return "video";
  if (contentType?.startsWith("audio/")) return "audio";
  return "file";
}

function apiError(status: number, message?: string): Error {
  if (status === 401)
    return new Error("Discord rejected this bot token. Reconnect the bot with a fresh token.");
  if (status === 403)
    return new Error(
      "Discord denied access. Give the bot View Channel, Read Message History, and Send Messages permissions for this channel."
    );
  if (status === 404) return new Error("This Discord channel or message is no longer available.");
  if (status === 413) return new Error("Discord rejected the attachment because it is too large.");
  return new Error(message ? `Discord: ${message}` : `Discord request failed (${status}).`);
}

/**
 * Official Discord bot connector.
 *
 * This deliberately accepts only bot tokens. It can see server channels where
 * the installed bot has permission and DMs sent directly to the bot; it cannot
 * impersonate a human account or read that person's private Discord inbox.
 */
export class DiscordBotAdapter implements Adapter {
  platform = "discord" as const;

  private readonly token: string;
  private status: AdapterStatus = {
    platform: "discord",
    state: "starting",
    detail: "Connecting official Discord bot…",
  };
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private firstHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTask: Promise<void> | null = null;
  private stopped = false;
  private fatal = false;
  private heartbeatAcknowledged = true;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private botUser: DiscordUser | null = null;
  private guildCount = 0;
  private reconnectAttempt = 0;
  private onMessage: ((message: InboundMessage) => Promise<void>) | null = null;
  private onReaction: ((reaction: InboundReaction) => Promise<void>) | null = null;
  private readonly channels = new Map<string, ChannelMeta>();
  private readonly backfilledGuilds = new Set<string>();
  private readonly allowedChannelIds = new Set(
    (process.env.DISCORD_CHANNEL_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  constructor(token: string) {
    this.token = cleanToken(token);
    if (!this.token) throw new Error("Discord bot token is missing.");
  }

  getStatus(): AdapterStatus {
    return { ...this.status };
  }

  async start(
    onMessage: (message: InboundMessage) => Promise<void>,
    _onRead?: (chatExternalId: string) => Promise<void>,
    onReaction?: (reaction: InboundReaction) => Promise<void>
  ): Promise<void> {
    this.onMessage = onMessage;
    this.onReaction = onReaction || null;
    this.stopped = false;
    this.fatal = false;
    await this.connect();
  }

  async ensureReady(): Promise<void> {
    if (this.status.state === "ready" && this.ws?.readyState === WebSocket.OPEN) return;
    if (this.fatal) throw new Error(this.status.detail || "Discord bot is disconnected.");
    await this.connect();
    if (this.status.state !== "ready")
      throw new Error(this.status.detail || "Discord bot is still connecting.");
  }

  async recover(): Promise<void> {
    if (this.fatal) throw new Error(this.status.detail || "Discord bot needs attention.");
    this.clearConnectionTimers();
    const old = this.ws;
    this.ws = null;
    if (old && old.readyState < WebSocket.CLOSING) old.close(4000, "Reconnect");
    await this.connect();
  }

  private canUseChannel(channelId: string): boolean {
    return !this.allowedChannelIds.size || this.allowedChannelIds.has(channelId);
  }

  private async request<T>(pathname: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bot ${this.token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");

    const response = await fetch(`${API_BASE}${pathname}`, { ...init, headers });
    const raw = await response.text();
    let data: unknown = undefined;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = undefined;
      }
    }

    if (response.status === 429 && retry) {
      const retryAfterSeconds = Number(
        data && typeof data === "object" && "retry_after" in data
          ? (data as { retry_after?: number }).retry_after
          : response.headers.get("retry-after") || 1
      );
      const retryAfterMs = Math.max(250, retryAfterSeconds * 1000);
      if (retryAfterMs <= 5_000) {
        await wait(retryAfterMs);
        return this.request<T>(pathname, init, false);
      }
      throw new Error(`Discord is rate limiting this action. Try again in ${Math.ceil(retryAfterSeconds)} seconds.`);
    }

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data
          ? String((data as { message?: unknown }).message || "")
          : undefined;
      throw apiError(response.status, message);
    }
    return data as T;
  }

  private connect(): Promise<void> {
    if (this.status.state === "ready" && this.ws?.readyState === WebSocket.OPEN)
      return Promise.resolve();
    if (this.connectTask) return this.connectTask;
    this.connectTask = this.openGateway().finally(() => {
      this.connectTask = null;
    });
    return this.connectTask;
  }

  private async openGateway(): Promise<void> {
    if (this.stopped) throw new Error("Discord bot is stopped.");
    this.status = {
      platform: "discord",
      state: "starting",
      detail: this.reconnectAttempt ? "Reconnecting Discord bot…" : "Connecting official Discord bot…",
    };

    const gateway = this.resumeGatewayUrl
      ? { url: this.resumeGatewayUrl }
      : await this.request<{ url: string }>("/gateway/bot");
    const url = `${gateway.url.replace(/\/$/, "")}/?v=10&encoding=json`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      this.ws = socket;

      const ready = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      socket.on("message", (raw: RawData) => {
        let packet: GatewayPacket;
        try {
          packet = JSON.parse(raw.toString()) as GatewayPacket;
        } catch {
          return;
        }
        if (typeof packet.s === "number") this.sequence = packet.s;

        if (packet.op === 10) {
          this.startHeartbeat(Number(packet.d?.heartbeat_interval || 45_000));
          if (this.sessionId && this.sequence !== null) {
            this.sendGateway({
              op: 6,
              d: { token: this.token, session_id: this.sessionId, seq: this.sequence },
            });
          } else {
            this.sendGateway({
              op: 2,
              d: {
                token: this.token,
                intents: INTENTS,
                properties: { os: process.platform, browser: "omnicrm", device: "omnicrm" },
              },
            });
          }
          return;
        }
        if (packet.op === 11) {
          this.heartbeatAcknowledged = true;
          return;
        }
        if (packet.op === 1) {
          this.heartbeat();
          return;
        }
        if (packet.op === 7) {
          socket.close(4000, "Gateway requested reconnect");
          return;
        }
        if (packet.op === 9) {
          if (!packet.d) {
            this.sessionId = null;
            this.sequence = null;
            this.resumeGatewayUrl = null;
          }
          setTimeout(() => socket.close(4000, "Invalid session"), 1_000 + Math.random() * 3_000);
          return;
        }
        if (packet.op !== 0 || !packet.t) return;

        if (packet.t === "READY") {
          this.botUser = packet.d.user as DiscordUser;
          this.sessionId = String(packet.d.session_id);
          this.resumeGatewayUrl = String(packet.d.resume_gateway_url || gateway.url);
          this.guildCount = Array.isArray(packet.d.guilds) ? packet.d.guilds.length : 0;
          this.reconnectAttempt = 0;
          this.status = {
            platform: "discord",
            state: "ready",
            detail: `@${this.botUser.username} · ${this.guildCount} ${this.guildCount === 1 ? "server" : "servers"}`,
          };
          ready();
          return;
        }
        if (packet.t === "RESUMED") {
          this.reconnectAttempt = 0;
          this.status = {
            platform: "discord",
            state: "ready",
            detail: this.botUser
              ? `@${this.botUser.username} · ${this.guildCount} ${this.guildCount === 1 ? "server" : "servers"}`
              : "Discord bot connected",
          };
          ready();
          return;
        }

        void this.handleDispatch(packet.t, packet.d).catch((error) =>
          console.error("[discord] event error:", error)
        );
      });

      socket.on("error", (error) => {
        if (!settled) fail(new Error(`Discord gateway connection failed: ${error.message}`));
      });

      socket.on("close", (code) => {
        this.clearConnectionTimers();
        if (this.ws === socket) this.ws = null;
        if (this.stopped) {
          fail(new Error("Discord bot stopped."));
          return;
        }

        const detail = this.closeDetail(code);
        const fatal = code === 4004 || code === 4010 || code === 4011 || code === 4013 || code === 4014;
        if (fatal) {
          this.fatal = true;
          this.status = { platform: "discord", state: "disconnected", detail };
          fail(new Error(detail));
          return;
        }

        this.status = { platform: "discord", state: "starting", detail };
        fail(new Error(detail));
        this.scheduleReconnect();
      });
    });
  }

  private closeDetail(code: number): string {
    if (code === 4004) return "Discord rejected the bot token. Reconnect with a fresh bot token.";
    if (code === 4013) return "Discord rejected the gateway intents configured for this bot.";
    if (code === 4014)
      return "Enable Message Content Intent in the Discord Developer Portal, then reconnect.";
    if (code === 4011) return "This bot is in too many servers for a single gateway connection.";
    return `Discord connection closed (${code || "network"}); reconnecting…`;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.fatal || this.reconnectTimer) return;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt++, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        if (!this.fatal) {
          this.status = { platform: "discord", state: "starting", detail: String(error) };
          this.scheduleReconnect();
        }
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private sendGateway(packet: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(packet));
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatAcknowledged = true;
    this.firstHeartbeatTimer = setTimeout(() => {
      this.heartbeat();
      this.heartbeatTimer = setInterval(() => this.heartbeat(), intervalMs);
      this.heartbeatTimer.unref?.();
    }, Math.floor(Math.random() * intervalMs));
    this.firstHeartbeatTimer.unref?.();
  }

  private heartbeat(): void {
    if (!this.heartbeatAcknowledged) {
      this.ws?.close(4000, "Heartbeat not acknowledged");
      return;
    }
    this.heartbeatAcknowledged = false;
    this.sendGateway({ op: 1, d: this.sequence });
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.firstHeartbeatTimer) clearTimeout(this.firstHeartbeatTimer);
    this.heartbeatTimer = null;
    this.firstHeartbeatTimer = null;
  }

  private clearConnectionTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async handleDispatch(event: string, data: unknown): Promise<void> {
    if (event === "GUILD_CREATE") {
      const guild = data as {
        id: string;
        name: string;
        icon?: string | null;
        channels?: DiscordChannel[];
        threads?: DiscordChannel[];
      };
      const allChannels = [...(guild.channels || []), ...(guild.threads || [])];
      for (const channel of allChannels) {
        this.channels.set(channel.id, {
          ...channel,
          guild_id: guild.id,
          guildName: guild.name,
          guildIcon: guild.icon,
        });
      }
      if (!this.backfilledGuilds.has(guild.id)) {
        this.backfilledGuilds.add(guild.id);
        void this.backfillGuild(guild.id, allChannels).catch((error) =>
          console.error(`[discord] initial history error for guild ${guild.id}:`, error)
        );
      }
      return;
    }
    if (event === "CHANNEL_CREATE" || event === "CHANNEL_UPDATE" || event === "THREAD_CREATE") {
      const channel = data as DiscordChannel;
      const previous = this.channels.get(channel.id);
      this.channels.set(channel.id, { ...previous, ...channel });
      return;
    }
    if (event === "CHANNEL_DELETE" || event === "THREAD_DELETE") {
      this.channels.delete((data as { id: string }).id);
      return;
    }
    if (event === "MESSAGE_CREATE") {
      const message = data as DiscordMessage;
      if (!this.canUseChannel(message.channel_id)) return;
      await this.deliverMessage(message, false);
      return;
    }
    if ((event === "MESSAGE_REACTION_ADD" || event === "MESSAGE_REACTION_REMOVE") && this.onReaction) {
      const reaction = data as {
        channel_id: string;
        message_id: string;
        user_id: string;
        emoji: { id?: string | null; name?: string | null };
        member?: { user?: DiscordUser; nick?: string | null };
      };
      if (!this.canUseChannel(reaction.channel_id)) return;
      const emoji = reaction.emoji.id
        ? `<${reaction.emoji.name || "emoji"}:${reaction.emoji.id}>`
        : reaction.emoji.name || "";
      if (!emoji) return;
      await this.onReaction({
        platform: "discord",
        messageExternalId: messageKey(reaction.channel_id, reaction.message_id),
        actor: {
          externalKey: `discord-user:${reaction.user_id}`,
          name: reaction.member?.nick || userName(reaction.member?.user),
        },
        emoji,
        removed: event === "MESSAGE_REACTION_REMOVE",
      });
    }
  }

  private async channelMeta(channelId: string): Promise<ChannelMeta> {
    const cached = this.channels.get(channelId);
    if (cached) return cached;
    const channel = await this.request<DiscordChannel>(`/channels/${channelId}`);
    const meta: ChannelMeta = { ...channel };
    this.channels.set(channelId, meta);
    return meta;
  }

  private messageBody(message: DiscordMessage): string {
    const mentionNames = new Map((message.mentions || []).map((user) => [user.id, userName(user)]));
    let body = String(message.content || "").replace(/<@!?(\d+)>/g, (_match, id: string) =>
      mentionNames.has(id) ? `@${mentionNames.get(id)}` : "@member"
    );
    if (!body) {
      const embed = message.embeds?.find((item) => item.description || item.title);
      body = embed?.description || embed?.title || "";
    }
    if (!body && message.sticker_items?.length) body = `[Sticker: ${message.sticker_items[0].name}]`;
    if (!body && !message.attachments?.length) body = "[Discord message]";
    if ((message.attachments?.length || 0) > 1)
      body = `${body}${body ? " · " : ""}${message.attachments!.length} attachments`;
    return body;
  }

  private async normalizeMessage(
    message: DiscordMessage,
    historical: boolean
  ): Promise<InboundMessage> {
    const channel: ChannelMeta = await this.channelMeta(message.channel_id).catch(
      (): ChannelMeta => ({
        id: message.channel_id,
        type: message.guild_id ? 0 : 1,
        guild_id: message.guild_id,
      })
    );
    const ownMessage = message.author.id === this.botUser?.id;
    const isGuild = Boolean(message.guild_id || channel.guild_id);
    const recipient = channel.recipients?.find((user) => user.id !== this.botUser?.id);
    const dmPerson = ownMessage ? recipient : message.author;
    const channelName = channel.name || `channel-${message.channel_id.slice(-6)}`;
    const guildName = channel.guildName || "Discord";
    const attachment = message.attachments?.[0];
    const sticker = !attachment ? message.sticker_items?.[0] : undefined;
    const referencedMessage = message.referenced_message;
    const referencedMessageId =
      referencedMessage?.id || message.message_reference?.message_id;

    return {
      platform: "discord",
      chatExternalId: message.channel_id,
      messageExternalId: messageKey(message.channel_id, message.id),
      direction: ownMessage ? "out" : "in",
      body: this.messageBody(message),
      timestamp: new Date(message.timestamp),
      historical,
      mentionsMe:
        !ownMessage &&
        Boolean(
          this.botUser &&
            message.mentions?.some((mentioned) => mentioned.id === this.botUser?.id)
        ),
      replyToExternalKey: referencedMessageId
        ? messageKey(message.channel_id, referencedMessageId)
        : undefined,
      replyPreview: referencedMessage
        ? this.messageBody(referencedMessage)
        : undefined,
      replySender: referencedMessage
        ? referencedMessage.author.id === this.botUser?.id
          ? "You"
          : referencedMessage.member?.nick || userName(referencedMessage.author)
        : undefined,
      media: attachment
        ? {
            type: mediaType(attachment.content_type),
            url: attachment.url || attachment.proxy_url || null,
            name: attachment.filename,
          }
        : sticker
          ? {
              type: "sticker",
              url: `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
              name: sticker.name,
            }
          : undefined,
      contact: isGuild
        ? {
            externalKey: `discord-channel:${message.channel_id}`,
            name: `${guildName} · #${channelName}`,
            handle: `#${channelName}`,
            avatarUrl:
              channel.guild_id && channel.guildIcon
                ? `https://cdn.discordapp.com/icons/${channel.guild_id}/${channel.guildIcon}.png?size=128`
                : undefined,
          }
        : {
            externalKey: `discord-dm:${message.channel_id}`,
            name: userName(dmPerson, "Discord DM"),
            handle: dmPerson ? `@${dmPerson.username}` : "Discord DM",
            avatarUrl: userAvatar(dmPerson),
          },
      isGroup: isGuild || channel.type === 3,
      sender:
        isGuild && !ownMessage
          ? {
              externalKey: `discord-user:${message.author.id}`,
              name: message.member?.nick || userName(message.author),
              avatarUrl: userAvatar(message.author),
            }
          : undefined,
    };
  }

  async recoverMedia(chatExternalId: string, messageExternalId: string): Promise<void> {
    if (!this.onMessage) throw new Error("Discord is disconnected");
    const id = messageExternalId.split(":").at(-1)!;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(chatExternalId)) throw new Error("Invalid Discord message ID");
    const message = await this.request<DiscordMessage>(`/channels/${chatExternalId}/messages/${id}`);
    const inbound = await this.normalizeMessage(message, true);
    if (!inbound.media?.url) throw new Error("Discord attachment unavailable");
    const url = new URL(inbound.media.url);
    if (url.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)) throw new Error("Unexpected Discord attachment host");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error(`Discord attachment HTTP ${response.status}`);
    inbound.media.url = await saveMediaStream(messageExternalId, extFromMime(response.headers.get("content-type") || "", "bin"), Readable.fromWeb(response.body as any), MAX_BYTES);
    await this.onMessage(inbound);
  }

  private async deliverMessage(message: DiscordMessage, historical: boolean): Promise<void> {
    if (!this.onMessage) return;
    await this.onMessage(await this.normalizeMessage(message, historical));
  }

  private async fetchHistory(
    channelId: string,
    count: number,
    beforeMessageId?: string,
    cutoff?: number
  ): Promise<number> {
    let before = beforeMessageId;
    let remaining = Math.max(1, Math.min(500, count));
    let imported = 0;
    while (remaining > 0) {
      const limit = Math.min(100, remaining);
      const params = new URLSearchParams({ limit: String(limit) });
      if (before) params.set("before", before);
      const batch = await this.request<DiscordMessage[]>(
        `/channels/${channelId}/messages?${params.toString()}`
      );
      if (!batch.length) break;
      const chronological = [...batch].reverse();
      for (const message of chronological) {
        const timestamp = new Date(message.timestamp).getTime();
        if (cutoff && timestamp < cutoff) continue;
        await this.deliverMessage(message, true);
        imported++;
      }
      remaining -= batch.length;
      before = batch[batch.length - 1].id;
      if (batch.length < limit || (cutoff && new Date(batch[batch.length - 1].timestamp).getTime() < cutoff))
        break;
    }
    return imported;
  }

  private async backfillGuild(guildId: string, channels: DiscordChannel[]): Promise<void> {
    const maxChannels = Math.max(0, Number(process.env.DISCORD_BACKFILL_CHATS || 40));
    const perChannel = Math.max(1, Number(process.env.DISCORD_BACKFILL_MESSAGES || 25));
    const days = Math.max(1, Number(process.env.DISCORD_BACKFILL_DAYS || 14));
    const cutoff = Date.now() - days * 86_400_000;
    const readableChannels = channels.filter(
      (channel) => TEXT_CHANNEL_TYPES.has(channel.type) && this.canUseChannel(channel.id)
    );
    const candidates = maxChannels ? readableChannels.slice(0, maxChannels) : readableChannels;
    let imported = 0;
    let accessible = 0;
    for (const channel of candidates) {
      try {
        const count = await this.fetchHistory(channel.id, perChannel, undefined, cutoff);
        imported += count;
        accessible++;
      } catch (error) {
        if (!/denied access|no longer available/i.test(String(error)))
          console.warn(`[discord] skipped channel ${channel.id}:`, String(error));
      }
      await wait(75);
    }
    console.log(
      `[discord] imported ${imported} recent messages from ${accessible} readable channels in guild ${guildId}`
    );
  }

  async requestHistory(
    chatExternalId: string,
    oldestMessageId: string,
    _oldestTimestamp: number,
    count = 200
  ): Promise<void> {
    if (!this.canUseChannel(chatExternalId))
      throw new Error("This Discord channel is outside DISCORD_CHANNEL_IDS.");
    await this.ensureReady();
    const before = messageIdFromKey(oldestMessageId);
    await this.fetchHistory(chatExternalId, count, before);
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    _mentions?: string[],
    replyToExternalId?: string
  ): Promise<SentMessage> {
    if (!this.canUseChannel(chatExternalId))
      throw new Error("This Discord channel is outside DISCORD_CHANNEL_IDS.");
    await this.ensureReady();
    if (body.length > 2_000) throw new Error("Discord messages can contain at most 2,000 characters.");

    const replyId = replyToExternalId ? messageIdFromKey(replyToExternalId) : undefined;
    const payload: Record<string, unknown> = {
      content: body,
      allowed_mentions: { parse: [], replied_user: false },
      ...(replyId
        ? { message_reference: { message_id: replyId, channel_id: chatExternalId, fail_if_not_exists: false } }
        : {}),
    };
    let init: RequestInit;
    if (media) {
      const bytes = await readFile(media.path);
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      form.append("files[0]", new Blob([bytes], { type: media.mime || "application/octet-stream" }), media.name);
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", body: JSON.stringify(payload) };
    }

    const sent = await this.request<DiscordMessage>(`/channels/${chatExternalId}/messages`, init);
    return {
      messageExternalId: messageKey(chatExternalId, sent.id),
      timestamp: sent.timestamp,
    };
  }

  private async mutationTarget(chatExternalId: string, messageExternalId: string) {
    if (!this.canUseChannel(chatExternalId)) throw new Error("This Discord channel is outside DISCORD_CHANNEL_IDS.");
    await this.ensureReady();
    const nativeId = nativeMutationId("discord", chatExternalId, messageExternalId);
    const path = `/channels/${chatExternalId}/messages/${nativeId}`;
    const message = await this.request<DiscordMessage>(path);
    if (!this.botUser?.id || message.author.id !== this.botUser.id || message.channel_id !== chatExternalId) {
      throw new Error("Only messages sent by this Discord bot can be changed.");
    }
    return path;
  }

  async editMessage(chatExternalId: string, messageExternalId: string, body: string): Promise<void> {
    const path = await this.mutationTarget(chatExternalId, messageExternalId);
    await this.request(path, { method: "PATCH", body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }) });
  }

  async deleteMessage(chatExternalId: string, messageExternalId: string): Promise<void> {
    const path = await this.mutationTarget(chatExternalId, messageExternalId);
    await this.request(path, { method: "DELETE" });
  }

  async react(
    chatExternalId: string,
    messageExternalId: string,
    reaction: OutboundReaction
  ): Promise<void> {
    if (!this.canUseChannel(chatExternalId))
      throw new Error("This Discord channel is outside DISCORD_CHANNEL_IDS.");
    await this.ensureReady();
    const messageId = messageIdFromKey(messageExternalId);
    if (!messageId) throw new Error("Discord message ID is invalid");
    const emoji = encodeURIComponent(reaction.emoji);
    await this.request<void>(
      `/channels/${chatExternalId}/messages/${messageId}/reactions/${emoji}/@me`,
      { method: reaction.remove ? "DELETE" : "PUT" }
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearConnectionTimers();
    const socket = this.ws;
    this.ws = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Stopped");
    this.status = { platform: "discord", state: "disconnected", detail: "Discord bot stopped" };
  }
}
