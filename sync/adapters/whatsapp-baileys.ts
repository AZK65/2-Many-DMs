import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason,
  getContentType,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { extFromMime, saveMedia, MAX_BYTES } from "../media";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  MediaType,
  OutboundMedia,
  SentMessage,
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

export class WhatsAppBaileysAdapter implements Adapter {
  platform = "whatsapp" as const;
  private sock?: ReturnType<typeof makeWASocket>;
  private state: AdapterStatus["state"] = "starting";
  private qr: string | null = null;
  private detail?: string;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  private onRead?: (chatExternalId: string) => Promise<void>;
  private authDir: string;
  private proxyUrl?: string;
  private stopped = false;

  // clientId namespaces the auth folder so multiple accounts don't collide.
  constructor(opts: { proxyUrl?: string; clientId?: string } = {}) {
    this.proxyUrl = opts.proxyUrl;
    this.authDir = path.join(
      DATA_DIR,
      ".baileys_auth",
      (opts.clientId || "default").replace(/[^a-zA-Z0-9_.-]/g, "_")
    );
  }

  getStatus(): AdapterStatus {
    return {
      platform: "whatsapp",
      state: this.state,
      qr: this.state === "qr" ? this.qr : null,
      detail: this.detail,
    };
  }

  async start(
    onMessage: (m: InboundMessage) => Promise<void>,
    onRead?: (chatExternalId: string) => Promise<void>
  ): Promise<void> {
    this.onMessage = onMessage;
    this.onRead = onRead;
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    // TODO(proxy): route the WS through this.proxyUrl per-account via an Agent
    // (needs https-proxy-agent). Omitted for now to keep the adapter dependency-light.

    const sock = makeWASocket({
      version,
      auth: state,
      logger: silent,
      browser: ["2 Many DMs", "Chrome", "1.0.0"],
      syncFullHistory: process.env.SYNC_BACKFILL !== "0",
      markOnlineOnConnect: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u: any) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        this.state = "qr";
        try {
          this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
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
        this.qr = null;
        const me = sock.user?.id ? numberFromJid(sock.user.id) : undefined;
        this.detail = me ? "+" + me : undefined;
        console.log("[whatsapp:baileys] ready", this.detail || "");
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.state = "disconnected";
        this.qr = null;
        console.error(
          `[whatsapp:baileys] connection closed (code ${code})${
            loggedOut ? " — logged out" : ""
          }`
        );
        if (!loggedOut && !this.stopped) {
          setTimeout(() => {
            if (!this.stopped) {
              this.connect().catch((e) =>
                console.error("[whatsapp:baileys] reconnect failed:", e)
              );
            }
          }, 5000);
        }
      }
    });

    // Live messages (and our own echoed sends, fromMe).
    sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        try {
          const im = await this.toInbound(msg);
          if (im && this.onMessage) await this.onMessage(im);
        } catch (e) {
          console.error("[whatsapp:baileys] message handler error:", e);
        }
      }
    });

    // Initial history sync (backfill arrives as an event, not a pull).
    sock.ev.on("messaging-history.set", async ({ messages }: any) => {
      if (!messages?.length || !this.onMessage) return;
      let count = 0;
      for (const msg of messages) {
        try {
          const im = await this.toInbound(msg);
          if (im) {
            await this.onMessage(im);
            count++;
          }
        } catch {
          /* skip unreadable history item */
        }
      }
      if (count) console.log(`[whatsapp:baileys] backfilled ${count} messages`);
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

  private async toInbound(msg: any): Promise<InboundMessage | null> {
    const jid: string | undefined = msg.key?.remoteJid;
    if (!jid || !isIndividual(jid)) return null; // skip groups, status@broadcast
    if (!msg.message) return null; // protocol/empty
    const norm = jidNormalizedUser(jid);
    const number = numberFromJid(norm);
    const contentType = getContentType(msg.message);
    const body = extractText(msg.message);

    const avatarKey = `whatsapp_${norm}`;
    let avatarUrl = existingAvatar(avatarKey) || undefined;
    if (!avatarUrl) {
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
        name: msg.pushName || number,
        handle: "+" + number,
        avatarUrl,
      },
    };

    const mt = mediaTypeFromContent(contentType);
    if (mt) {
      let url: string | null = null;
      let mediaName: string | undefined;
      try {
        const buf = (await downloadMediaMessage(
          msg,
          "buffer",
          {},
          { logger: silent, reuploadRequest: this.sock!.updateMediaMessage }
        )) as Buffer;
        if (buf && buf.length <= MAX_BYTES) {
          const content: any = (msg.message as any)[contentType!];
          const mime: string =
            content?.mimetype ||
            content?.message?.documentMessage?.mimetype ||
            "";
          const ext = extFromMime(mime, mt === "sticker" ? "webp" : "bin");
          url = saveMedia(base.messageExternalId, ext, buf);
          if (mt === "file")
            mediaName =
              content?.fileName ||
              content?.message?.documentMessage?.fileName ||
              undefined;
        }
      } catch {
        /* media expired on WA servers or undownloadable */
      }
      base.media = { type: mt, url, name: mediaName };
    }

    return base;
  }

  async markRead(chatExternalId: string): Promise<void> {
    // Baileys marks read by message key; we don't track the last key here, so
    // this is a best-effort no-op-safe call. (Read receipts still send when the
    // user replies.) Left intentionally light to avoid sending wrong receipts.
    void chatExternalId;
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia
  ): Promise<SentMessage> {
    if (!this.sock) throw new Error("WhatsApp (baileys) not ready");
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
      content = { text: body };
    }
    const sent: any = await this.sock.sendMessage(chatExternalId, content);
    const id = sent?.key?.id || Math.random().toString(36).slice(2);
    return {
      messageExternalId: `whatsapp:${chatExternalId}:${id}`,
      timestamp: new Date().toISOString(),
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try {
      this.sock?.end(undefined);
    } catch {
      /* already closed */
    }
  }
}
