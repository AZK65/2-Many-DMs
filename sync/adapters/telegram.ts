import fs from "node:fs";
import path from "node:path";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { existingAvatar, saveAvatarBuffer } from "../avatars";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  MediaType,
  OutboundMedia,
  SentMessage,
} from "./types";

// GramJS message/entity objects are richly typed; we read a handful of fields
// and its convenience getters (msg.photo, msg.video, ...), so we treat them as
// loose shapes here rather than importing the full Api types.
/* eslint-disable @typescript-eslint/no-explicit-any */

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 25) * 1024 * 1024;

function contactFrom(chat: any): InboundMessage["contact"] {
  const name =
    [chat.firstName, chat.lastName].filter(Boolean).join(" ") ||
    chat.username ||
    "Telegram user";
  const handle = chat.username
    ? "@" + chat.username
    : chat.phone
    ? "+" + chat.phone
    : String(chat.id);
  return { externalKey: `telegram:${chat.id}`, name, handle };
}

function resolveMedia(
  msg: any
): { type: MediaType; ext: string; name?: string; size: number; downloadable: boolean } | null {
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
    // Animated .tgs stickers can't render in a browser — keep a label only.
    return { type: "sticker", ext: "tgs", size, downloadable: false };
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

export class TelegramAdapter implements Adapter {
  platform = "telegram" as const;
  private client: TelegramClient;
  private state: AdapterStatus["state"] = "starting";
  private detail?: string;

  constructor(apiId: number, apiHash: string, session: string) {
    this.client = new TelegramClient(
      new StringSession(session),
      apiId,
      apiHash,
      { connectionRetries: 5 }
    );
  }

  private async downloadToPublic(
    msg: any,
    messageExternalId: string,
    ext: string
  ): Promise<string | null> {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const filename = `${messageExternalId.replace(/:/g, "_")}.${ext}`;
    const fullPath = path.join(MEDIA_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      const buf = await this.client.downloadMedia(msg, {});
      if (!buf) return null;
      fs.writeFileSync(fullPath, buf as Buffer);
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

  private async buildMessage(chat: any, msg: any): Promise<InboundMessage> {
    const chatId = String(chat.id);
    const messageExternalId = `telegram:${chatId}:${msg.id}`;
    const caption = msg.message && msg.message.length ? msg.message : "";

    const contact = contactFrom(chat);
    contact.avatarUrl = await this.avatarFor(chat);

    const base: InboundMessage = {
      platform: "telegram",
      chatExternalId: chatId,
      messageExternalId,
      direction: msg.out ? "out" : "in",
      body: caption,
      timestamp: new Date(Number(msg.date) * 1000),
      contact,
    };

    const resolved = resolveMedia(msg);
    if (resolved) {
      let url: string | null = null;
      if (resolved.downloadable && resolved.size <= MAX_BYTES) {
        url = await this.downloadToPublic(msg, messageExternalId, resolved.ext).catch(
          () => null
        );
      }
      base.media = { type: resolved.type, url, name: resolved.name };
    } else if (!caption) {
      // No text and no recognized media (poll, contact, location, etc.)
      base.body = "[unsupported message]";
    }

    return base;
  }

  getStatus(): AdapterStatus {
    return { platform: "telegram", state: this.state, detail: this.detail };
  }

  async start(
    onMessage: (m: InboundMessage) => Promise<void>,
    onRead?: (chatExternalId: string) => Promise<void>
  ): Promise<void> {
    await this.client.connect();
    this.state = "ready";

    if (process.env.SYNC_BACKFILL !== "0") {
      await this.backfill(onMessage).catch((e) =>
        console.error("[telegram] backfill error:", e)
      );
    }

    this.client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const msg: any = event.message;
        if (!msg.isPrivate) return; // DM inbox only — skip groups/channels
        const chat = await msg.getChat();
        if (!chat) return;
        await onMessage(await this.buildMessage(chat, msg));
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
  }

  private async backfill(
    onMessage: (m: InboundMessage) => Promise<void>
  ): Promise<void> {
    const dialogLimit = Number(process.env.SYNC_BACKFILL_DIALOGS || 30);
    const msgLimit = Number(process.env.SYNC_BACKFILL_MESSAGES || 20);
    const dialogs = await this.client.getDialogs({ limit: dialogLimit });
    let count = 0;
    for (const d of dialogs) {
      if (!d.isUser || !d.entity) continue;
      const chat: any = d.entity;
      const messages = await this.client.getMessages(d.entity, {
        limit: msgLimit,
      });
      for (const msg of [...messages].reverse()) {
        if (!msg) continue;
        await onMessage(await this.buildMessage(chat, msg));
        count++;
      }
    }
    console.log(
      `[telegram] backfilled ${count} messages from ${dialogs.length} dialogs`
    );
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia
  ): Promise<SentMessage> {
    // Telegram user ids are well within Number's safe-integer range.
    const peer = await this.client.getInputEntity(Number(chatExternalId));
    let sent: any;
    if (media) {
      // forceDocument keeps arbitrary files as documents instead of trying to
      // render them as photos/videos.
      sent = await this.client.sendFile(peer, {
        file: media.path,
        caption: body || undefined,
        forceDocument: media.type === "file",
      });
    } else {
      sent = await this.client.sendMessage(peer, { message: body });
    }
    return {
      messageExternalId: `telegram:${chatExternalId}:${sent.id}`,
      timestamp: new Date().toISOString(),
    };
  }

  async markRead(chatExternalId: string): Promise<void> {
    const peer = await this.client.getInputEntity(Number(chatExternalId));
    await this.client.invoke(
      new Api.messages.ReadHistory({ peer, maxId: 0 })
    );
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
  }
}

export { MEDIA_LABEL };
