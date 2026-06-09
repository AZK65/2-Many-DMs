import path from "node:path";
import { Client, LocalAuth } from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import { extFromMime, saveMedia, MAX_BYTES } from "../media";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import { cleanChromeLocks, HARDENED_CHROME_ARGS } from "../chrome-locks";
import { chromeProxyServer, proxyArgs } from "../proxy";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  MediaType,
  SentMessage,
} from "./types";

/* whatsapp-web.js Message/Chat objects expose more than its published types;
   we read a typed subset and treat instances loosely where needed. */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Persist sessions on a volume in hosted deploys (set DATA_DIR=/data on Railway).
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const WA_SESSION_DIR = path.join(DATA_DIR, ".wwebjs_auth");

// Modern WhatsApp identifies a 1:1 chat by either the classic phone-number id
// ("...@c.us") or the newer privacy "linked id" ("...@lid"). Groups are @g.us.
function isIndividualChat(id?: string): boolean {
  return !!id && /@(c\.us|lid)$/.test(id);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function mediaTypeFromWa(type: string): MediaType | null {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "ptt":
      return "audio";
    case "sticker":
      return "sticker";
    case "document":
      return "file";
    default:
      return null;
  }
}

export class WhatsAppAdapter implements Adapter {
  platform = "whatsapp" as const;
  private client!: Client;
  private state: AdapterStatus["state"] = "starting";
  private qr: string | null = null;
  private detail?: string;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  // Standard whatsapp-web.js re-emits authenticated/ready repeatedly; these
  // guards ensure the workaround and backfill each run once per connection.
  private syncTriggered = false;
  private readyDone = false;

  private buildClient(proxy: string | null): Client {
    // Pinning a known-good WhatsApp Web build fixes "can't link device" /
    // stuck-loading errors caused by a stale bundled web version. Set
    // WHATSAPP_WEB_VERSION to a filename (without .html) from
    // https://github.com/wppconnect-team/wa-version/tree/main/html
    const webVersion = process.env.WHATSAPP_WEB_VERSION;
    return new Client({
      authStrategy: new LocalAuth({ dataPath: WA_SESSION_DIR }),
      ...(webVersion
        ? {
            webVersionCache: {
              type: "remote",
              remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${webVersion}.html`,
            },
          }
        : {}),
      puppeteer: {
        headless: true,
        timeout: 60000,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [...HARDENED_CHROME_ARGS, ...proxyArgs(proxy)],
      },
    });
  }

  private cleanLocks(): void {
    cleanChromeLocks(path.join(WA_SESSION_DIR, "session"));
  }

  // After a fresh link "ready" fires before history syncs, so getChats() can
  // return empty. Poll it (the public API, version-robust) until it's populated
  // instead of guessing a fixed delay or poking version-specific Store internals.
  private async getChatsWhenReady(): Promise<any[]> {
    const start = Date.now();
    const maxWait = Number(process.env.WHATSAPP_READY_MAX_MS || 45000);
    while (Date.now() - start < maxWait) {
      try {
        const chats = (await withTimeout(
          this.client.getChats(),
          30000,
          "getChats"
        )) as any[];
        if (chats.length > 0) return chats;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return [];
  }

  getStatus(): AdapterStatus {
    return {
      platform: "whatsapp",
      state: this.state,
      qr: this.state === "qr" ? this.qr : null,
      detail: this.detail,
    };
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    this.onMessage = onMessage;
    await this.connect();
  }

  private async connect(): Promise<void> {
    this.syncTriggered = false;
    this.readyDone = false;
    this.cleanLocks();
    const proxy = await chromeProxyServer();
    this.client = this.buildClient(proxy);
    this.attachHandlers();
    try {
      await this.client.initialize();
    } catch (e) {
      this.state = "disconnected";
      console.error("[whatsapp] init error:", e);
    }
  }

  private attachHandlers(): void {
    const onMessage = this.onMessage!;

    this.client.on("qr", async (qr) => {
      this.state = "qr";
      try {
        this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      } catch {
        this.qr = null;
      }
      console.log(
        "\n[whatsapp] Scan in the app (Connections panel) or with this terminal QR:\n"
      );
      qrcodeTerminal.generate(qr, { small: true });
    });

    // Some WhatsApp Web builds fire 'authenticated' but never 'ready' (the page
    // loads and just hangs). Once AppState reports it's synced, manually fire
    // the internal synced event so whatsapp-web.js emits 'ready'. (Ported from
    // the ds-attendance-platform client.)
    this.client.on("authenticated", async () => {
      if (this.syncTriggered) return; // ignore the library's repeat emissions
      this.syncTriggered = true;
      console.log("[whatsapp] authenticated");
      const pp = (this.client as any).pupPage;
      if (!pp) return;
      try {
        await pp.evaluate(`(async () => {
          const start = Date.now();
          while (!window.AuthStore?.AppState && Date.now() - start < 30000) {
            await new Promise(r => setTimeout(r, 500));
          }
          const appState = window.AuthStore?.AppState;
          if (appState?.hasSynced && window.onAppStateHasSyncedEvent) {
            window.onAppStateHasSyncedEvent();
          }
        })()`);
      } catch (e) {
        console.error("[whatsapp] ready-event workaround failed:", e);
      }
    });

    this.client.on("ready", async () => {
      this.state = "ready";
      this.qr = null;
      const me: any = this.client.info;
      this.detail = me?.wid?.user ? "+" + me.wid.user : undefined;
      if (this.readyDone) return; // backfill only once per connection
      this.readyDone = true;
      console.log("[whatsapp] ready");
      if (process.env.SYNC_BACKFILL !== "0") {
        await this.backfill(onMessage).catch((e) =>
          console.error("[whatsapp] backfill error:", e)
        );
      }
    });

    this.client.on("auth_failure", (m) => {
      this.state = "disconnected";
      console.error("[whatsapp] auth failure:", m);
    });

    this.client.on("disconnected", (r: string) => {
      this.state = "disconnected";
      this.qr = null;
      console.error("[whatsapp] disconnected:", r);
      // Auto-reconnect unless the user intentionally logged out.
      if (r !== "LOGOUT") {
        console.log("[whatsapp] reconnecting in 10s…");
        setTimeout(() => {
          if (this.state !== "ready") {
            this.connect().catch((e) =>
              console.error("[whatsapp] reconnect failed:", e)
            );
          }
        }, 10000);
      }
    });

    // message_create fires for both inbound messages and our own sends.
    this.client.on("message_create", async (msg: any) => {
      try {
        const im = await this.toInbound(msg);
        if (im) await onMessage(im);
      } catch (e) {
        console.error("[whatsapp] handler error:", e);
      }
    });

    // Surface page crashes / frame detachment so we mark disconnected and the
    // reconnect path can recover.
    const pp = (this.client as any).pupPage;
    if (pp) {
      pp.on("error", (err: Error) => {
        console.error("[whatsapp] page error:", err.message);
        if (/detached|Target closed/i.test(err.message)) this.state = "disconnected";
      });
    }
  }

  private async toInbound(msg: any): Promise<InboundMessage | null> {
    const chatId: string = msg.fromMe ? msg.to : msg.from;
    // Individual chats only (@c.us or @lid); skip groups, status, broadcasts.
    if (!isIndividualChat(chatId)) return null;
    // Skip WhatsApp system/protocol artifacts (e.g. "0@c.us") that aren't
    // real conversations and carry no usable sender.
    if (/^0+@(c\.us|lid)$/.test(chatId)) return null;
    if (msg.type === "e2e_notification" || msg.type === "notification_template")
      return null;

    // Resolve the OTHER party from the chat peer, not msg.getContact() — for
    // our own outgoing messages that would return us, not the recipient.
    let number = chatId.replace(/@(c\.us|lid)$/, "");
    let name = number;
    try {
      const contact = await this.client.getContactById(chatId);
      number = (contact as any)?.number || number;
      name =
        (contact as any)?.pushname ||
        (contact as any)?.name ||
        (contact as any)?.shortName ||
        number;
    } catch {
      // Fall back to the raw number if the contact can't be resolved.
    }

    const avatarKey = `whatsapp_${chatId}`;
    let avatarUrl = existingAvatar(avatarKey) || undefined;
    if (!avatarUrl) {
      try {
        const picUrl = await this.client.getProfilePicUrl(chatId);
        if (picUrl) avatarUrl = (await saveAvatarFromUrl(avatarKey, picUrl)) || undefined;
      } catch {
        /* no picture / privacy */
      }
    }

    const base: InboundMessage = {
      platform: "whatsapp",
      chatExternalId: chatId,
      messageExternalId: `whatsapp:${msg.id._serialized}`,
      direction: msg.fromMe ? "out" : "in",
      body: typeof msg.body === "string" ? msg.body : "",
      timestamp: new Date(Number(msg.timestamp) * 1000),
      contact: {
        externalKey: `whatsapp:${chatId}`,
        name,
        handle: "+" + number,
        avatarUrl,
      },
    };

    if (msg.hasMedia) {
      const mt = mediaTypeFromWa(msg.type);
      if (mt) {
        let url: string | null = null;
        let mediaName: string | undefined;
        try {
          const media = await msg.downloadMedia();
          if (media?.data) {
            const buf = Buffer.from(media.data, "base64");
            if (buf.length <= MAX_BYTES) {
              const ext = extFromMime(media.mimetype || "");
              url = saveMedia(base.messageExternalId, ext, buf);
            }
            if (mt === "file") mediaName = media.filename || undefined;
          }
        } catch {
          // Media for old messages can expire on WhatsApp's servers.
        }
        // Captions live in body for media messages already.
        base.media = { type: mt, url, name: mediaName };
      }
    }

    return base;
  }

  private async backfill(
    onMessage: (m: InboundMessage) => Promise<void>
  ): Promise<void> {
    const chatLimit = Number(process.env.WHATSAPP_BACKFILL_CHATS || 25);
    const msgLimit = Number(process.env.SYNC_BACKFILL_MESSAGES || 20);

    // Wait until the chat list is actually populated before reading.
    const all = await this.getChatsWhenReady();
    const groups = all.filter((c) => c.isGroup).length;
    console.log(
      `[whatsapp] getChats total=${all.length} groups=${groups} dms=${
        all.length - groups
      }`
    );
    const dms = all
      .filter((c) => !c.isGroup && isIndividualChat(c.id?._serialized))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, chatLimit);

    let count = 0;
    for (const chat of dms) {
      try {
        const messages = await withTimeout<any[]>(
          chat.fetchMessages({ limit: msgLimit }),
          20000,
          "fetchMessages"
        );
        for (const msg of messages) {
          const im = await this.toInbound(msg);
          if (im) {
            await onMessage(im);
            count++;
          }
        }
      } catch (e) {
        console.error(
          "[whatsapp] skipped chat",
          chat.id?._serialized,
          String(e)
        );
      }
    }
    console.log(`[whatsapp] backfilled ${count} messages from ${dms.length} chats`);
  }

  async send(chatExternalId: string, body: string): Promise<SentMessage> {
    const sent: any = await this.client.sendMessage(chatExternalId, body);
    return {
      messageExternalId: `whatsapp:${sent.id._serialized}`,
      timestamp: new Date().toISOString(),
    };
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }
}
