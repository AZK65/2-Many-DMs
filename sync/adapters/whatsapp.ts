import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import {
  extFromMime,
  saveMedia,
  saveMediaStream,
  MAX_BYTES,
} from "../media";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import { cleanChromeLocks, HARDENED_CHROME_ARGS } from "../chrome-locks";
import { chromeProxyServer, proxyArgs } from "../proxy";
import { isPlaceholderIdentity, whatsappDisplayName, type WhatsAppIdentity } from "../whatsapp-identity";
import type {
  Adapter,
  AdapterStatus,
  ArchiveChatContext,
  InboundMessage,
  MediaType,
  OutboundMedia,
  OutboundReaction,
  ResolvedDirectContact,
  SentMessage,
  InboundReaction,
} from "./types";

/* whatsapp-web.js Message/Chat objects expose more than its published types;
   we read a typed subset and treat instances loosely where needed. */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Persist sessions on a volume in hosted deploys (set DATA_DIR=/data on Railway).
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const WA_SESSION_DIR = path.join(DATA_DIR, ".wwebjs_auth");
const RECOVERY_MAX_BYTES =
  Number(process.env.MEDIA_RECOVERY_MAX_MB || 250) * 1024 * 1024;

// Modern WhatsApp identifies a 1:1 chat by either the classic phone-number id
// ("...@c.us") or the newer privacy "linked id" ("...@lid"). Groups are @g.us.
function isIndividualChat(id?: string): boolean {
  return !!id && /@(c\.us|lid)$/.test(id);
}

function isGroupChat(id?: string): boolean {
  return !!id && /@g\.us$/.test(id);
}

function nativeMessageId(msg: any): string | null {
  const raw =
    msg?.id?.id ||
    msg?.id?._serialized ||
    msg?.id?.$1 ||
    msg?._data?.id?.id ||
    msg?._data?.id?._serialized ||
    msg?._data?.id?.$1;
  if (typeof raw !== "string" || !raw || raw === "undefined") return null;
  // Serialized WhatsApp message keys are `<fromMe>_<chat>_<native id>`.
  // The native id itself does not contain underscores.
  return raw.includes("_") ? raw.split("_").at(-1) || null : raw;
}

function canonicalMessageExternalId(chatId: string, msg: any): string {
  const nativeId = nativeMessageId(msg);
  return nativeId
    ? `whatsapp:${chatId}:${nativeId}`
    : `whatsapp:${chatId}:pending:${randomUUID()}`;
}

class WhatsAppOperationTimeoutError extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new WhatsAppOperationTimeoutError(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function mediaDescriptorFromWa(msg: any): {
  directPath?: string;
  mediaKey?: string;
  mimetype?: string;
  filename?: string;
  type?: string;
} {
  const data = msg?._data || msg || {};
  const rawKey = msg?.mediaKey ?? data.mediaKey;
  let mediaKey: string | undefined;
  if (typeof rawKey === "string") {
    mediaKey = rawKey;
  } else if (rawKey instanceof Uint8Array || Buffer.isBuffer(rawKey)) {
    mediaKey = Buffer.from(rawKey).toString("base64");
  } else if (Array.isArray(rawKey)) {
    mediaKey = Buffer.from(rawKey).toString("base64");
  } else if (rawKey?.type === "Buffer" && Array.isArray(rawKey.data)) {
    mediaKey = Buffer.from(rawKey.data).toString("base64");
  }

  return {
    directPath: msg?.directPath || data.directPath || undefined,
    mediaKey,
    mimetype: msg?.mimetype || data.mimetype || undefined,
    filename: msg?.filename || data.filename || undefined,
    type: msg?.type || data.type || undefined,
  };
}

export class WhatsAppAdapter implements Adapter {
  platform = "whatsapp" as const;
  private client!: Client;
  private state: AdapterStatus["state"] = "starting";
  private qr: string | null = null;
  private qrRefreshPromise?: Promise<void>;
  private lastQrRefreshAt = 0;
  private qrGeneration = 0;
  private detail?: string;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  private onRead?: (chatExternalId: string) => Promise<void>;
  private onReaction?: (r: InboundReaction) => Promise<void>;
  // whatsapp-web.js has no "read on phone" event, so we poll unread counts and
  // fire onRead when a chat's unread count drops. Tracks the last seen count.
  private lastUnread = new Map<string, number>();
  private readPoll?: ReturnType<typeof setInterval>;
  private recentSyncPromise?: Promise<void>;
  private cachedChatReads = new WeakMap<Client, Promise<any[]>>();
  private recentChatVersions = new Map<string, string>();
  private recentImportedKeys = new Set<string>();
  private chatNames = new Map<string, string>();
  private contactNames = new Map<string, any>();
  private identityRefreshAt = 0;
  private onIdentities?: (identities: WhatsAppIdentity[]) => Promise<void>;
  private healthPoll?: ReturnType<typeof setInterval>;
  private recoveryPromise?: Promise<void>;
  private connectionPromise?: Promise<void>;
  private retiredClients = new WeakSet<Client>();
  private watchedClients = new WeakSet<Client>();
  private healthChecking = false;
  private healthFailures = 0;
  private activeSends = 0;
  private sendTail: Promise<void> = Promise.resolve();
  private stopping = false;
  private messageCache = new Map<string, any>();
  // Standard whatsapp-web.js re-emits authenticated/ready repeatedly; these
  // guards ensure the workaround and backfill each run once per connection.
  private syncTriggered = false;
  private readyDone = false;
  private authEpoch = 0;
  private proxyUrl?: string;

  // Per-account ready: pass the account's proxy. Falls back to global PROXY_URL.
  constructor(opts: { proxyUrl?: string; onIdentities?: (identities: WhatsAppIdentity[]) => Promise<void> } = {}) {
    this.proxyUrl = opts.proxyUrl;
    this.onIdentities = opts.onIdentities;
  }

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
        // Diagnostic mode exposes the existing connector profile, so native
        // onboarding/security prompts can be completed without a second login.
        headless: process.env.WHATSAPP_HEADLESS !== "0",
        timeout: 60000,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [...HARDENED_CHROME_ARGS, ...proxyArgs(proxy)],
      },
    });
  }

  // WhatsApp Web changed MsgKey serialization and the history-loader signature
  // without changing the public web version. Older whatsapp-web.js builds pass
  // an undefined message key into IndexedDB, which makes getChatById/getChats
  // fail even though the linked session and the in-page chat store are healthy.
  private async installWebCompatibilityPatches(): Promise<void> {
    const page = (this.client as any).pupPage;
    if (!page) return;
    await page.evaluate(`(() => {
      if (!window.WWebJS) return;
      if (!window.WWebJS.__omniMsgKeyPatched) {
        const chats = window.Store?.Chat?.getModelsArray?.() || [];
        const sampleKey = chats.map((chat) => chat?.lastReceivedKey).find((key) => key?.$1);
        const prototype = sampleKey && Object.getPrototypeOf(sampleKey);
        if (prototype && !sampleKey._serialized) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "_serialized");
          if (!descriptor || descriptor.configurable) {
            Object.defineProperty(prototype, "_serialized", {
              configurable: true,
              get() { return this.__omniSerialized || this.$1; },
              set(value) {
                Object.defineProperty(this, "__omniSerialized", {
                  value,
                  writable: true,
                  configurable: true,
                });
              },
            });
          }
        }
        window.WWebJS.__omniMsgKeyPatched = true;
      }
      if (!window.WWebJS.__omniGetChatPatched) {
        const original = window.WWebJS.getChatModel.bind(window.WWebJS);
        window.WWebJS.getChatModel = async (chat, options) => {
          const key = chat?.lastReceivedKey;
          if (key && !key._serialized && key.$1) {
            try {
              Object.defineProperty(key, "_serialized", {
                value: key.$1,
                configurable: true,
              });
            } catch (_) {
              try { key._serialized = key.$1; } catch (_) {}
            }
          }
          return original(chat, options);
        };
        window.WWebJS.__omniGetChatPatched = true;
      }
      if (!window.WWebJS.__omniMediaMessageIdPatched) {
        // Current WhatsApp Web MediaData models expose an enumerable private
        // __x_id. whatsapp-web.js spreads that model into the outgoing
        // message after assigning its real MsgKey, so the private media id
        // replaces the message id and every image/video/audio send crashes in
        // Msg.initialize. Patch the injected helper at the construction point
        // and remove only the colliding private field.
        const source = String(window.WWebJS.sendMessage);
        const marker = "if (botOptions) {";
        if (!source.includes(marker)) {
          throw new Error("WhatsApp media-send patch point was not found");
        }
        const patched = source.replace(
          marker,
          "delete message.__x_id;\\n        " + marker
        );
        window.WWebJS.sendMessage = (0, eval)("(" + patched + ")");
        window.WWebJS.__omniMediaMessageIdPatched = true;
      }
    })()`);
  }

  // Load history through WhatsApp's current module, then let whatsapp-web.js
  // serialize the already-cached messages. Its bundled fetchMessages pagination
  // still calls the removed two-argument loader and currently crashes.
  private async loadEarlierMessages(
    chatExternalId: string,
    limit: number,
    sinceTimestamp?: number
  ): Promise<void> {
    const page = (this.client as any).pupPage;
    if (!page) throw new Error("WhatsApp page is unavailable");
    await page.evaluate(
      async ({ chatId, messageLimit, since }: {
        chatId: string;
        messageLimit: number;
        since: number;
      }) => {
        const pageWindow = window as any;
        const chat = await pageWindow.WWebJS.getChat(chatId, { getAsModel: false });
        if (!chat) throw new Error("WhatsApp chat was not found");
        const loader = pageWindow.require("WAWebChatLoadMessages")?.loadEarlierMsgs;
        if (typeof loader !== "function") return;
        for (let pageNumber = 0; pageNumber < 25; pageNumber++) {
          const cached = chat.msgs.getModelsArray();
          if (cached.length >= messageLimit) break;
          const timestamps = cached
            .map((message: any) => Number(message.t || 0) * 1000)
            .filter(Boolean);
          if (since && timestamps.length && Math.min(...timestamps) <= since) break;
          const before = cached.length;
          const loaded = await loader({ chat });
          const after = chat.msgs.getModelsArray().length;
          if (!loaded?.length || after <= before) break;
        }
      },
      {
        chatId: chatExternalId,
        messageLimit: Math.max(1, Math.min(limit, 500)),
        since: sinceTimestamp || 0,
      }
    );
  }

  private async refreshExpiredMedia(
    chatExternalId: string,
    nativeMessageId: string
  ): Promise<{
    stage: string;
    directPath?: string;
    mediaKey?: string;
    mimetype?: string;
    filename?: string;
    type?: string;
  }> {
    const page = (this.client as any).pupPage;
    if (!page) throw new Error("WhatsApp page is unavailable");
    const input = JSON.stringify({
      chatId: chatExternalId,
      nativeId: nativeMessageId,
    });
    return withTimeout(page.evaluate(`(async () => {
      const { chatId, nativeId } = ${input};
      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      const message = chat?.msgs?.getModelsArray()?.find((candidate) =>
        candidate?.id?.id === nativeId ||
        candidate?.id?._serialized?.endsWith("_" + nativeId) ||
        candidate?.id?.$1?.endsWith("_" + nativeId)
      );
      if (!message) return { stage: "MESSAGE_NOT_FOUND" };

      const result = (stage) => ({
        stage,
        directPath: message.directPath || undefined,
        mediaKey:
          typeof message.mediaKey === "string"
            ? message.mediaKey
            : message.mediaKey
              ? btoa(String.fromCharCode(...message.mediaKey))
              : undefined,
        mimetype: message.mimetype || undefined,
        filename: message.filename || undefined,
        type: message.type || undefined,
      });

      const requestMedia = async () => {
        const request = Promise.resolve(message.downloadMedia({
            downloadEvenIfExpensive: true,
            rmrReason: 1,
          })).catch(() => undefined);
        await Promise.race([
          request,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      };

      const initialStage = String(message.mediaData?.mediaStage || "UNKNOWN");
      if (message.directPath && message.mediaKey) return result(initialStage);
      await requestMedia();
      for (let attempt = 0; attempt < 40; attempt++) {
        const stage = String(message.mediaData?.mediaStage || "UNKNOWN");
        if (stage === "RESOLVED" && message.directPath) return result(stage);
        if (attempt > 0 && attempt % 10 === 0) await requestMedia();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return result(String(message.mediaData?.mediaStage || "UNKNOWN"));
    })()`) as Promise<{
      stage: string;
      directPath?: string;
      mediaKey?: string;
      mimetype?: string;
      filename?: string;
      type?: string;
    }>, 30_000, "WhatsApp attachment refresh");
  }

  private async downloadResolvedMedia(
    descriptor: {
      directPath?: string;
      mediaKey?: string;
      mimetype?: string;
      filename?: string;
      type?: string;
    },
    messageExternalId: string,
    maxBytes = RECOVERY_MAX_BYTES
  ): Promise<{ url: string; name?: string; type: MediaType }> {
    const mediaType = mediaTypeFromWa(descriptor.type || "");
    if (!mediaType || !descriptor.directPath || !descriptor.mediaKey) {
      throw new Error("WhatsApp did not return complete attachment details.");
    }
    const downloadType = mediaType === "file" ? "document" : mediaType;
    const stream = await downloadContentFromMessage(
      {
        directPath: descriptor.directPath,
        mediaKey: new Uint8Array(Buffer.from(descriptor.mediaKey, "base64")),
      },
      downloadType as any
    );
    const filenameExtension = path.extname(descriptor.filename || "").slice(1);
    const extension =
      filenameExtension ||
      extFromMime(
        descriptor.mimetype || "",
        mediaType === "sticker" ? "webp" : "bin"
      );
    return {
      url: await saveMediaStream(
        messageExternalId,
        extension,
        stream,
        maxBytes
      ),
      name: mediaType === "file" ? descriptor.filename : undefined,
      type: mediaType,
    };
  }

  private cleanLocks(): void {
    cleanChromeLocks(path.join(WA_SESSION_DIR, "session"));
  }

  private async disposeClient(client?: Client): Promise<void> {
    if (!client) return;
    this.retiredClients.add(client);
    client.removeAllListeners();

    const browser = (client as any).pupBrowser;
    const chromeProcess = browser?.process?.();
    try {
      await withTimeout(
        Promise.resolve(client.destroy()),
        2_500,
        "WhatsApp browser shutdown"
      );
    } catch (error) {
      console.error("[whatsapp] graceful browser shutdown failed:", error);
    }

    // A detached/crashed page can make whatsapp-web.js destroy() return
    // without actually reaping Chromium. Close the Puppeteer browser directly,
    // then terminate only this client's child process if it is still alive.
    if (browser?.isConnected?.()) {
      try {
        await withTimeout(
          Promise.resolve(browser.close()),
          1_000,
          "WhatsApp browser close"
        );
      } catch (error) {
        console.error("[whatsapp] forced browser close failed:", error);
      }
    }

    if (chromeProcess && chromeProcess.exitCode === null) {
      try {
        chromeProcess.kill("SIGTERM");
      } catch {
        return;
      }
      await new Promise<void>((resolve) => {
        if (chromeProcess.exitCode !== null) return resolve();
        const timer = setTimeout(resolve, 500);
        chromeProcess.once?.("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (chromeProcess.exitCode === null) {
        try {
          chromeProcess.kill("SIGKILL");
        } catch {
          // The process exited between the final check and signal.
        }
      }
    }
  }

  // getChats() serializes every group via GroupMetadata.update and may fetch
  // missing last messages. Automatic catch-up must only inspect local caches.
  // Keep ownership until Puppeteer really settles, even if a caller times out.
  private readCachedChats(client: Client = this.client): Promise<any[]> {
    const pending = this.cachedChatReads.get(client);
    if (pending) return pending;
    const read = (async () => {
      const rows = await (client as any).pupPage.evaluate(() => {
        const store = (window as any).Store;
        if (!store?.Chat?.getModelsArray) throw new Error("WhatsApp chat cache is not ready");
        return store.Chat.getModelsArray().flatMap((chat: any) => {
          const id = chat.id?._serialized;
          if (!id || !/@(c\.us|lid|g\.us)$/.test(id)) return [];
          // No serialize(), group metadata refresh, message lookup, or network.
          const cached = chat.msgs?.getModelsArray?.() || [];
          const newest = cached.reduce((latest: number, message: any) => Math.max(latest, Number(message.t || 0)), 0);
          return [{
            id: { _serialized: id },
            formattedTitle: chat.formattedTitle || chat.name || chat.groupMetadata?.subject || "",
            isGroup: id.endsWith("@g.us"),
            unreadCount: chat.unreadCount || 0,
            t: Math.max(Number(chat.t || chat.timestamp || 0), newest),
            archive: !!chat.archive,
          }];
        });
      });
      // The public Chat wrapper's fetchMessages({limit: 0}) reads cached
      // messages without calling getChatModel or paging earlier history.
      const { Chat: CachedChat } = require("whatsapp-web.js");
      return rows.map((row: any) => new CachedChat(client, row));
    })();
    this.cachedChatReads.set(client, read);
    void read.finally(() => {
      if (this.cachedChatReads.get(client) === read) this.cachedChatReads.delete(client);
    }).catch(() => {});
    return read;
  }

  // After a fresh link "ready" fires before history syncs, so the cache can
  // return empty. Poll it (the public API, version-robust) until it's populated
  // instead of guessing a fixed delay or poking version-specific Store internals.
  private async getChatsWhenReady(): Promise<any[]> {
    const start = Date.now();
    const maxWait = Number(process.env.WHATSAPP_READY_MAX_MS || 45000);
    while (Date.now() - start < maxWait) {
      try {
        const chats = (await withTimeout(
          this.readCachedChats(),
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
    if (this.state === "ready" && !this.browserIsAlive(this.client)) {
      this.state = "disconnected";
      this.detail = "Browser connection lost; reconnecting";
    }
    return {
      platform: "whatsapp",
      state: this.state,
      qr: this.state === "qr" ? this.qr : null,
      detail: this.detail,
    };
  }

  private isCurrentClient(client: Client): boolean {
    return !this.stopping && this.client === client && !this.retiredClients.has(client);
  }

  private browserIsAlive(client: Client): boolean {
    const browser = (client as any)?.pupBrowser;
    const page = (client as any)?.pupPage;
    return !!browser && browser.isConnected() && !!page && !page.isClosed();
  }

  private watchBrowser(client: Client): void {
    const page = (client as any).pupPage;
    const browser = (client as any).pupBrowser;
    if (!page || !browser || this.watchedClients.has(client)) return;
    this.watchedClients.add(client);
    const lost = () => {
      if (!this.isCurrentClient(client)) return;
      this.state = "disconnected";
      this.detail = "Browser connection lost; reconnecting";
    };
    page.on("close", lost);
    page.on("error", lost);
    // Reset synchronously before the library's async injection resumes. Its fork keeps a
    // process-level _readyEmitted flag across document reloads. Without a
    // reset, it skips injecting Store/WWebJS into the new page, leaving a
    // phone-linked session unable to receive messages.
    page.on("framenavigated", (frame: any) => {
      if (!this.isCurrentClient(client) || frame !== page.mainFrame()) return;
      if (!frame.url().includes("post_logout=1") && !(client as any).lastLoggedOut) {
        (client as any)._readyEmitted = false;
        (client as any)._authEventListenersInjected = false;
        this.authEpoch++;
        this.syncTriggered = false;
        this.readyDone = false;
        this.healthFailures = 0;
        this.qrGeneration++;
        this.qr = null;
        this.state = "starting";
        this.detail = "WhatsApp Web reloading; restoring saved connection";
      }
      // Record only a logout flag, never URLs, QR contents or session secrets.
      console.log(`[whatsapp] main-frame navigation at=${new Date().toISOString()} logoutRedirect=${frame.url().includes("post_logout=1")}`);
    });
    browser.on("disconnected", lost);
  }

  private async pageIsHealthy(): Promise<boolean> {
    const page = (this.client as any)?.pupPage;
    if (!page || page.isClosed?.()) return false;
    const frame = page.mainFrame?.();
    if (
      !frame ||
      frame.detached === true ||
      frame.isDetached?.() === true
    ) {
      return false;
    }
    try {
      return await withTimeout(
        page.evaluate("Boolean(window.WWebJS && window.Store)"),
        3000,
        "WhatsApp browser health check"
      );
    } catch {
      return false;
    }
  }

  async ensureReady(): Promise<void> {
    if (this.state !== "ready") throw new Error("WhatsApp is reconnecting");
    if (await this.pageIsHealthy()) return;

    // whatsapp-web.js can keep reporting ready after Chromium replaces or
    // detaches the page's main frame. Detect that before attempting a send so
    // we can restart the browser instead of leaving every message red forever.
    this.state = "starting";
    void this.recover().catch((error) =>
      console.error("[whatsapp] automatic recovery failed:", error)
    );
    throw new Error(
      "WhatsApp restarted its browser connection before sending. Try again in a moment."
    );
  }

  async recover(): Promise<void> {
    if (this.stopping) return;
    if (this.recoveryPromise) return this.recoveryPromise;
    if (this.activeSends > 0) throw new Error("WhatsApp recovery deferred while a message is sending");
    this.recoveryPromise = (async () => {
      if (this.connectionPromise) await this.connectionPromise;
      if (this.stopping) return;
      this.state = "starting";
      const previousClient = this.client;
      await this.disposeClient(previousClient);
      if (this.stopping) return;
      await this.connect();
      const deadline = Date.now() + Number(process.env.WHATSAPP_READY_MAX_MS || 45000);
      while (this.state === "starting" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (this.getStatus().state !== "ready") {
        throw new Error("WhatsApp did not reconnect");
      }
    })().finally(() => {
      this.recoveryPromise = undefined;
    });
    return this.recoveryPromise;
  }

  refreshQr(): Promise<void> {
    if (this.qrRefreshPromise) return this.qrRefreshPromise;
    if (this.stopping || this.state !== "qr") {
      return Promise.reject(new Error("WhatsApp is no longer waiting for a QR scan. Check its connection status."));
    }
    if (Date.now() - this.lastQrRefreshAt < 10_000) {
      return Promise.reject(new Error("Please wait a few seconds before requesting another code."));
    }
    let client = this.client;
    const previousQr = this.qr;
    this.lastQrRefreshAt = Date.now();
    this.qrGeneration++;
    this.qr = null;
    this.qrRefreshPromise = (async () => {
      const page = (client as any)?.pupPage;
      if (!page || page.isClosed()) throw new Error("WhatsApp's linking window is unavailable. Restart the connection and try again.");
      // Use the same native QR operation as whatsapp-web.js, but AuthStore is
      // available before authentication whereas Store may not exist yet.
      const requested = await withTimeout(page.evaluate(`(async () => {
        const state = window.AuthStore?.AppState?.state;
        if (state !== 'UNPAIRED' && state !== 'UNPAIRED_IDLE') {
          throw new Error('WhatsApp is already linking or connected. Check its connection status.');
        }
        const cmd = window.AuthStore?.Cmd;
        if (!cmd?.refreshQR) return false;
        await cmd.refreshQR();
        return true;
      })()`), 10_000, "WhatsApp QR request");
      if (requested === false) {
        // Some WhatsApp Web builds removed Cmd.refreshQR. Reopen only the
        // unauthenticated browser, retaining LocalAuth and all CRM history.
        // Recheck after the async page call so a phone scan wins this race.
        if (!this.isCurrentClient(client) || this.state !== "qr" || this.syncTriggered) return;
        this.state = "starting";
        this.detail = "Generating a new QR code";
        await this.disposeClient(client);
        await this.connect();
        client = this.client;
      }
      const deadline = Date.now() + 15_000;
      while (this.isCurrentClient(client) && Date.now() < deadline) {
        const status = this.getStatus();
        if (status.state === "ready" || (status.state === "starting" && this.syncTriggered)) return;
        if (status.state !== "qr") throw new Error("WhatsApp disconnected while generating the code. Try again after reconnecting.");
        if (this.qr && this.qr !== previousQr) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("WhatsApp did not return a fresh QR code. Please try again.");
    })().finally(() => {
      this.qrRefreshPromise = undefined;
    });
    return this.qrRefreshPromise;
  }

  async start(
    onMessage: (m: InboundMessage) => Promise<void>,
    onRead?: (chatExternalId: string) => Promise<void>,
    onReaction?: (r: InboundReaction) => Promise<void>
  ): Promise<void> {
    this.stopping = false;
    this.onMessage = onMessage;
    this.onRead = onRead;
    this.onReaction = onReaction;
    await this.connect();
    this.startReadPoll();
    this.startHealthPoll();
  }

  private startHealthPoll(): void {
    if (this.healthPoll) return;
    this.healthPoll = setInterval(() => {
      if (this.stopping || this.state !== "ready" || this.recoveryPromise || this.healthChecking || this.activeSends > 0) return;
      const client = this.client;
      this.healthChecking = true;
      void this.pageIsHealthy()
        .then((healthy) => {
          if (!this.isCurrentClient(client) || this.state !== "ready") return;
          if (healthy) {
            this.healthFailures = 0;
            return;
          }
          // A busy tab or a brief navigation must not restart a healthy send.
          if (++this.healthFailures < 2 && this.browserIsAlive(client)) return;
          console.error("[whatsapp] browser page became unavailable; reconnecting");
          return this.recover();
        })
        .catch((error) =>
          console.error("[whatsapp] health recovery failed:", error)
        )
        .finally(() => { this.healthChecking = false; });
    }, 15000);
    this.healthPoll.unref?.();
  }

  // Poll chats for unread-count drops (a read on the phone) and clear the badge.
  private startReadPoll(): void {
    if (this.readPoll) return;
    this.readPoll = setInterval(() => {
      void this.reconcileRecentMessages().catch((error) =>
        console.error("[whatsapp] recent sync error:", error)
      );
    }, 30000);
    this.readPoll.unref?.();
  }

  // Linked-device history arrives after ready, without message_create events.
  // Reconcile changed chat caches in the background, independently of the
  // expensive global deep-backfill switch. Never page the network here.
  private reconcileRecentMessages(): Promise<void> {
    if (this.recentSyncPromise) return this.recentSyncPromise;
    if (this.state !== "ready" || this.stopping || this.activeSends || !this.onMessage) return Promise.resolve();
    const client = this.client;
    this.recentSyncPromise = (async () => {
      const chats: any[] = await withTimeout(this.readCachedChats(client), 20_000, "recent chats");
      if (!this.isCurrentClient(client)) return;
      const identities: WhatsAppIdentity[] = [];
      for (const chat of chats) {
        const id = chat.id?._serialized;
        if (!isGroupChat(id) || isPlaceholderIdentity(chat.name)) continue;
        this.chatNames.set(id, chat.name);
        identities.push({ externalKey: `whatsapp:${id}`, name: chat.name, handle: "Group" });
      }
      // The contact list is local linked-device metadata, not one network
      // request per member. Retry periodically as the phone sync fills it in.
      if (Date.now() - this.identityRefreshAt > 5 * 60_000) {
        try {
          const contacts: any[] = await withTimeout(client.getContacts(), 15_000, "contact names");
          if (!this.isCurrentClient(client)) return;
          for (const contact of contacts) {
            const id = contact.id?._serialized;
            const name = whatsappDisplayName(contact);
            if (!isIndividualChat(id) || !name) continue;
            this.contactNames.set(id, contact);
          }
          this.identityRefreshAt = Date.now();
        } catch (error) { console.error("[whatsapp] contact names unavailable:", error); }
      }
      for (const [id, contact] of this.contactNames) {
        identities.push({ externalKey: `whatsapp:${id}`, name: whatsappDisplayName(contact)!,
          handle: contact.number && id.endsWith("@c.us") ? `+${contact.number}` : whatsappDisplayName(contact) });
      }
      if (this.isCurrentClient(client)) await this.onIdentities?.(identities);
      const since = Date.now() / 1000 - 72 * 3600;
      let imported = 0;
      let checked = 0;
      let newest = 0;
      for (const chat of chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))) {
        if (!this.isCurrentClient(client) || this.state !== "ready" || this.activeSends) return;
        const id = chat.id?._serialized;
        if (!isIndividualChat(id) && !isGroupChat(id)) continue;
        const unread = chat.unreadCount ?? 0;
        const previousUnread = this.lastUnread.get(id);
        if (previousUnread !== undefined && unread < previousUnread) {
          this.onRead?.(id).catch(() => {});
        }
        this.lastUnread.set(id, unread);
        const timestamp = Number(chat.timestamp || chat.lastMessage?.timestamp || 0);
        newest = Math.max(newest, timestamp);
        if (timestamp && timestamp < since) continue;
        // Include cache size indirectly by periodically rechecking: late history
        // can land without changing the last-message key or timestamp.
        const version = `${timestamp}:${nativeMessageId(chat.lastMessage)}:${unread}:${Math.floor(Date.now() / 300_000)}`;
        if (this.recentChatVersions.get(id) === version) continue;
        try {
          const messages = await withTimeout<any[]>(chat.fetchMessages({ limit: 0 }), 10_000, "recent messages");
          for (const message of messages.sort((a, b) => Number(a.timestamp) - Number(b.timestamp))) {
            if (!this.isCurrentClient(client) || this.state !== "ready" || this.activeSends) return;
            if (Number(message.timestamp || 0) < since) continue;
            // Protocol placeholders without stable IDs must never generate a
            // new pending UUID on each pass. Remember successful imports so
            // delayed-history checks don't repeatedly rewrite the same rows.
            if (!nativeMessageId(message)) continue;
            const key = canonicalMessageExternalId(id, message);
            if (this.recentImportedKeys.has(key)) continue;
            const inbound = await this.toInbound(message, { downloadMedia: false, downloadAvatar: false, resolveQuoted: false });
            if (!this.isCurrentClient(client)) return;
            if (inbound) {
              inbound.historical = true;
              await this.onMessage!(inbound);
              this.recentImportedKeys.add(key);
              if (this.recentImportedKeys.size > 10_000) {
                this.recentImportedKeys.delete(this.recentImportedKeys.values().next().value!);
              }
              imported++;
            }
          }
          this.recentChatVersions.set(id, version);
          checked++;
        } catch (error) {
          console.error("[whatsapp] recent chat sync failed:", error);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (checked) console.log(`[whatsapp] recent sync checked=${checked} availableChats=${chats.length} processed=${imported} newest=${newest ? new Date(newest * 1000).toISOString() : "none"}`);
    })().finally(() => { this.recentSyncPromise = undefined; });
    return this.recentSyncPromise;
  }

  async markRead(chatExternalId: string): Promise<void> {
    const chat: any = await this.client.getChatById(chatExternalId);
    await chat.sendSeen();
    this.lastUnread.set(chatExternalId, 0);
  }

  async setArchivedAndMuted(
    chatExternalId: string,
    archived: boolean,
    _context?: ArchiveChatContext
  ): Promise<void> {
    await this.ensureReady();
    if (archived) {
      await this.client.muteChat(chatExternalId);
      try {
        await this.client.archiveChat(chatExternalId);
      } catch (error) {
        await this.client.unmuteChat(chatExternalId).catch(() => {});
        throw error;
      }
      return;
    }

    await this.client.unarchiveChat(chatExternalId);
    try {
      await this.client.unmuteChat(chatExternalId);
    } catch (error) {
      await this.client.archiveChat(chatExternalId).catch(() => {});
      throw error;
    }
  }

  private connect(): Promise<void> {
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.connectOnce().finally(() => {
      this.connectionPromise = undefined;
    });
    return this.connectionPromise;
  }

  private async connectOnce(): Promise<void> {
    if (this.stopping) return;
    this.state = "starting";
    this.qr = null;
    this.qrGeneration++;
    this.syncTriggered = false;
    this.readyDone = false;
    this.healthFailures = 0;
    this.cleanLocks();
    const proxy = await chromeProxyServer(this.proxyUrl);
    if (this.stopping) return;
    const client = this.buildClient(proxy);
    this.client = client;
    this.attachHandlers(client);
    try {
      await withTimeout(
        client.initialize(),
        Number(process.env.WHATSAPP_CONNECT_TIMEOUT_MS || 90_000),
        "WhatsApp startup"
      );
      if (this.isCurrentClient(client)) this.watchBrowser(client);
    } catch (e) {
      if (this.isCurrentClient(client)) {
        this.state = "disconnected";
        this.detail = "Connection interrupted; reconnecting";
      }
      await this.disposeClient(client);
      console.error("[whatsapp] init error:", e);
    }
  }

  private attachHandlers(client: Client): void {
    const onMessage = this.onMessage!;

    client.on("change_state", (state: string) => {
      if (!this.isCurrentClient(client)) return;
      const label = /^[A-Z_]{1,40}$/.test(state) ? state : "UNKNOWN";
      console.log(`[whatsapp] transport state=${label} at=${new Date().toISOString()}`);
    });

    client.on("qr", async (qr) => {
      if (!this.isCurrentClient(client) || this.syncTriggered || this.state === "ready") return;
      const generation = ++this.qrGeneration;
      this.state = "qr";
      this.detail = "Scan the QR code to link WhatsApp";
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 4, width: 320 });
        if (!this.isCurrentClient(client) || generation !== this.qrGeneration) return;
        this.qr = dataUrl;
      } catch {
        if (!this.isCurrentClient(client) || generation !== this.qrGeneration) return;
        this.qr = null;
      }
      console.log(
        "\n[whatsapp] Scan in the app (Connections panel) or with this terminal QR:\n"
      );
      qrcodeTerminal.generate(qr, { small: true });
    });

    // The installed library already handles hasSynced on session restore.
    // Do not call onAppStateHasSyncedEvent from authenticated: that event is
    // emitted inside the same initialization callback, before injection has
    // finished, so calling it again starts concurrent initialization.
    client.on("authenticated", () => {
      if (!this.isCurrentClient(client)) return;
      if (this.syncTriggered) return; // ignore the library's repeat emissions
      this.syncTriggered = true;
      this.qrGeneration++;
      this.qr = null;
      this.state = "starting";
      this.detail = "Phone linked; finishing connection";
      console.log(`[whatsapp] authenticated at=${new Date().toISOString()}`);
    });

    client.on("ready", async () => {
      if (!this.isCurrentClient(client)) return;
      if (this.state === "qr" || this.state === "disconnected") return;
      const epoch = this.authEpoch;
      try {
        await this.installWebCompatibilityPatches();
      } catch (error) {
        console.error("[whatsapp] compatibility patch failed:", error);
      }
      if (!this.isCurrentClient(client) || epoch !== this.authEpoch) return;
      this.watchBrowser(client);
      this.state = "ready";
      this.qrGeneration++;
      this.qr = null;
      const me: any = this.client.info;
      this.detail = me?.wid?.user ? "+" + me.wid.user : undefined;
      if (this.readyDone) return; // backfill only once per connection
      this.readyDone = true;
      console.log(`[whatsapp] ready at=${new Date().toISOString()}`);
      this.recentChatVersions.clear();
      void this.reconcileRecentMessages().catch((error) =>
        console.error("[whatsapp] reconnect catch-up failed:", error)
      );
      if (process.env.SYNC_BACKFILL !== "0") {
        await this.backfill(onMessage).catch((e) =>
          console.error("[whatsapp] backfill error:", e)
        );
      }
    });

    client.on("auth_failure", (m) => {
      if (!this.isCurrentClient(client)) return;
      this.authEpoch++;
      this.syncTriggered = false;
      this.readyDone = false;
      this.state = "disconnected";
      this.qrGeneration++;
      this.qr = null;
      console.error("[whatsapp] auth failure:", m);
      if (
        !this.stopping &&
        /target closed|detached|session closed/i.test(String(m))
      ) {
        console.log("[whatsapp] browser closed during startup; retrying in 5s…");
        setTimeout(() => {
          if (this.isCurrentClient(client) && this.state !== "ready") {
            this.recover().catch((error) =>
              console.error("[whatsapp] startup recovery failed:", error)
            );
          }
        }, 5_000);
      }
    });

    client.on("disconnected", (r: string) => {
      if (!this.isCurrentClient(client)) return;
      this.authEpoch++;
      this.syncTriggered = false;
      this.readyDone = false;
      this.state = "disconnected";
      this.detail = r === "LOGOUT"
        ? "WhatsApp logged out; scan the QR code in connection settings to link again"
        : "Connection interrupted; reconnecting";
      this.qrGeneration++;
      this.qr = null;
      console.error(`[whatsapp] disconnected: ${r} at=${new Date().toISOString()} browserAlive=${this.browserIsAlive(client)}`);
      // A logout may be remote, not user initiated. Do not churn the browser
      // while the library is returning to its QR screen; allow new auth events.
      if (r !== "LOGOUT" && !this.stopping) {
        console.log("[whatsapp] reconnecting in 10s…");
        setTimeout(() => {
          if (this.isCurrentClient(client) && this.state === "disconnected" && !/logged out/i.test(this.detail || "")) {
            this.recover().catch((e) =>
              console.error("[whatsapp] reconnect failed:", e)
            );
          }
        }, 10000);
      }
    });

    // message_create fires for both inbound messages and our own sends.
    client.on("message_reaction", async (r: any) => {
      if (!this.isCurrentClient(client)) return;
      if (!this.onReaction) return;
      try {
        const chatId = r?.msgId?.remote || r?.id?.remote;
        const msgId = r?.msgId?.id || r?.id?.id;
        if (!chatId || !msgId) return;
        const actor = String(r?.senderId || chatId).split("@")[0];
        await this.onReaction({
          platform: "whatsapp",
          messageExternalId: `whatsapp:${chatId}:${msgId}`,
          actor: { externalKey: `whatsapp:${actor}` },
          emojis: r?.reaction ? [r.reaction] : [],
        });
      } catch (e) {
        console.error("[whatsapp] reaction error:", e);
      }
    });

    client.on("message_create", async (msg: any) => {
      if (!this.isCurrentClient(client)) return;
      try {
        const im = await this.toInbound(msg);
        if (im && this.isCurrentClient(client)) {
          await onMessage(im);
          console.log(`[whatsapp] live message saved direction=${im.direction} timestamp=${im.timestamp.toISOString()}`);
        }
      } catch (e) {
        console.error("[whatsapp] handler error:", e);
      }
    });

    // The browser page does not exist until initialize() starts. Lifecycle
    // listeners are attached in ready/after initialize, once it is available.
  }

  private async toInbound(
    msg: any,
    options: {
      strictMedia?: boolean;
      downloadMedia?: boolean;
      downloadAvatar?: boolean;
      resolveQuoted?: boolean;
    } = {}
  ): Promise<InboundMessage | null> {
    const chatId: string = msg.fromMe ? msg.to : msg.from;
    const group = isGroupChat(chatId);
    if (!isIndividualChat(chatId) && !group) return null;
    // Skip WhatsApp system/protocol artifacts (e.g. "0@c.us") that aren't
    // real conversations and carry no usable sender.
    if (/^0+@(c\.us|lid)$/.test(chatId)) return null;
    if (msg.type === "e2e_notification" || msg.type === "notification_template")
      return null;
    const incomingMediaType = msg.hasMedia ? mediaTypeFromWa(msg.type) : null;
    if (!String(msg.body || "").trim() && !incomingMediaType) return null;

    // Resolve the OTHER party from the chat peer, not msg.getContact() — for
    // our own outgoing messages that would return us, not the recipient.
    let number = chatId.replace(/@(c\.us|lid|g\.us)$/, "");
    let name = group ? this.chatNames.get(chatId) || "Group chat" : number;
    if (group) {
      try {
        if (!this.chatNames.has(chatId)) {
          const chat: any = await withTimeout(this.client.getChatById(chatId), 3_000, "message chat metadata");
          if (!isPlaceholderIdentity(chat?.name)) {
            name = chat.name;
            this.chatNames.set(chatId, name);
          }
        }
      } catch {
        // Keep the safe group fallback if metadata is unavailable.
      }
    } else {
      try {
        const contact = this.contactNames.get(chatId) || await withTimeout(this.client.getContactById(chatId), 3_000, "contact metadata");
        number = (contact as any)?.number || number;
        name = whatsappDisplayName(contact) || number;
      } catch {
        // Fall back to the raw number if the contact can't be resolved.
      }
    }

    const avatarKey = `whatsapp_${chatId}`;
    let avatarUrl = existingAvatar(avatarKey) || undefined;
    if (!avatarUrl && options.downloadAvatar !== false) {
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
      messageExternalId: canonicalMessageExternalId(chatId, msg),
      direction: msg.fromMe ? "out" : "in",
      body: typeof msg.body === "string" ? msg.body : "",
      timestamp: new Date(Number(msg.timestamp) * 1000),
      contact: {
        externalKey: `whatsapp:${chatId}`,
        name,
        handle: group ? "Group" : "+" + number,
        avatarUrl,
      },
      isGroup: group,
    };

    this.messageCache.set(base.messageExternalId, msg);
    if (this.messageCache.size > 2000) {
      this.messageCache.delete(this.messageCache.keys().next().value!);
    }

    if (group && !msg.fromMe && msg.author) {
      const senderId = String(msg.author);
      let senderName = senderId.replace(/@.*$/, "");
      let senderAvatarUrl: string | undefined;
      try {
        const sender: any = this.contactNames.get(senderId) || await withTimeout(this.client.getContactById(senderId), 3_000, "sender metadata");
        senderName = whatsappDisplayName(sender) || senderName;
        const senderAvatarKey = `whatsapp_${senderId}`;
        senderAvatarUrl = existingAvatar(senderAvatarKey) || undefined;
        if (!senderAvatarUrl && options.downloadAvatar !== false) {
          const picture = await this.client.getProfilePicUrl(senderId);
          if (picture) {
            senderAvatarUrl = (await saveAvatarFromUrl(senderAvatarKey, picture)) || undefined;
          }
        }
      } catch {
        // Sender identity is helpful but not required to keep the message.
      }
      base.sender = {
        externalKey: `whatsapp:${senderId}`,
        name: senderName,
        avatarUrl: senderAvatarUrl,
      };
    }

    if (group && Array.isArray(msg.mentionedIds) && msg.mentionedIds.length) {
      const mentionedContacts: NonNullable<InboundMessage["mentionedContacts"]> = [];
      const seen = new Set<string>();
      const ownInfo: any = this.client.info;
      const ownIds = new Set(
        [ownInfo?.wid?._serialized, ownInfo?.lid?._serialized].filter(Boolean)
      );
      const ownUsers = new Set(
        [ownInfo?.wid?.user, ownInfo?.lid?.user].filter(Boolean).map(String)
      );
      for (const mentioned of msg.mentionedIds) {
        const mentionedId =
          typeof mentioned === "string" ? mentioned : mentioned?._serialized;
        if (!/@(?:c\.us|lid)$/.test(mentionedId || "") || seen.has(mentionedId))
          continue;
        seen.add(mentionedId);
        if (
          !msg.fromMe &&
          (ownIds.has(mentionedId) || ownUsers.has(mentionedId.replace(/@.*$/, "")))
        ) {
          base.mentionsMe = true;
        }
        try {
          const contact: any = this.contactNames.get(mentionedId) || await withTimeout(this.client.getContactById(mentionedId), 3_000, "mention metadata");
          const fallback = mentionedId.replace(/@.*$/, "");
          const memberName =
            whatsappDisplayName(contact) ||
            (contact?.number ? `+${contact.number}` : "WhatsApp member");
          mentionedContacts.push({
            externalKey: `whatsapp:${mentionedId}`,
            name: memberName,
            handle: contact?.number ? `+${contact.number}` : memberName || fallback,
          });
        } catch {
          // A missing contact lookup should not prevent the message syncing.
        }
      }
      if (mentionedContacts.length) base.mentionedContacts = mentionedContacts;
    }

    if (msg.hasQuotedMsg && options.resolveQuoted !== false) {
      try {
        const quoted: any = await withTimeout(
          msg.getQuotedMessage(),
          3_000,
          "getQuotedMessage"
        );
        const quotedId = quoted?.id?._serialized;
        if (quotedId) {
          const quotedChatId = quoted.fromMe ? quoted.to : quoted.from;
          base.replyToExternalKey = canonicalMessageExternalId(quotedChatId || chatId, quoted);
          base.replyPreview =
            String(quoted.body || "").trim() ||
            (mediaTypeFromWa(quoted.type) === "image"
              ? "Photo"
              : mediaTypeFromWa(quoted.type) === "video"
                ? "Video"
                : mediaTypeFromWa(quoted.type) === "audio"
                  ? "Voice message"
                  : mediaTypeFromWa(quoted.type) === "sticker"
                    ? "Sticker"
                    : mediaTypeFromWa(quoted.type) === "file"
                      ? "File"
                      : "Message");
          if (quoted.fromMe) {
            base.replySender = "You";
          } else if (group && quoted.author) {
            try {
              const quotedSender: any = await this.client.getContactById(quoted.author);
              base.replySender =
                quotedSender?.pushname ||
                quotedSender?.name ||
                quotedSender?.shortName ||
                String(quoted.author).replace(/@.*$/, "");
            } catch {
              base.replySender = String(quoted.author).replace(/@.*$/, "");
            }
          } else {
            base.replySender = name;
          }
        }
      } catch {
        // The quoted message may have expired from WhatsApp Web's local cache.
        // The main message still syncs normally when that happens.
      }
    }

    if (msg.hasMedia) {
      const mt = mediaTypeFromWa(msg.type);
      if (mt) {
        let url: string | null = null;
        let mediaName: string | undefined;
        if (options.downloadMedia !== false) {
          let downloadError: unknown;
          try {
            const directMedia = await this.downloadResolvedMedia(
              mediaDescriptorFromWa(msg),
              base.messageExternalId,
              MAX_BYTES
            );
            url = directMedia.url;
            mediaName = directMedia.name;
          } catch (error) {
            downloadError = error;
          }

          const directWasOverLimit =
            downloadError instanceof Error &&
            /larger than the .* attachment limit/i.test(downloadError.message);
          if (!url && !directWasOverLimit) {
            try {
              const media = await withTimeout<any>(
                Promise.resolve(msg.downloadMedia()),
                Number(process.env.WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT_MS || 15_000),
                "WhatsApp attachment download"
              );
              if (media?.data) {
                const buf = Buffer.from(media.data, "base64");
                if (buf.length <= MAX_BYTES) {
                  const ext = extFromMime(media.mimetype || "");
                  url = saveMedia(base.messageExternalId, ext, buf);
                } else {
                  downloadError = new Error(
                    `This attachment is larger than the ${Math.round(
                      MAX_BYTES / 1024 / 1024
                    )} MB automatic download limit.`
                  );
                }
                if (mt === "file") mediaName = media.filename || undefined;
              }
            } catch (error) {
              downloadError = error;
            }
          }
          if (!url && options.strictMedia) {
            throw downloadError instanceof Error
              ? downloadError
              : new Error("WhatsApp could not download this attachment.");
          }
        }
        // Captions live in body for media messages already.
        base.media = { type: mt, url, name: mediaName, isGif: msg.isGif === true };
      }
    }

    return base;
  }

  private async backfill(
    onMessage: (m: InboundMessage) => Promise<void>
  ): Promise<void> {
    // Startup repair must stay small and cache-only. Full history remains
    // available through the per-chat Backfill button. Reusing the global deep
    // backfill settings here made every worker restart walk 150 chats, resolve
    // hundreds of profile photos and download old media inside the same page
    // that handles live WhatsApp sends.
    const chatLimit = Number(process.env.WHATSAPP_STARTUP_BACKFILL_CHATS || 20);
    const msgLimit = Number(process.env.WHATSAPP_STARTUP_BACKFILL_MESSAGES || 10);

    // Wait until the chat list is actually populated before reading.
    const all = await this.getChatsWhenReady();
    const groups = all.filter((c) => c.isGroup).length;
    console.log(
      `[whatsapp] getChats total=${all.length} groups=${groups} dms=${
        all.length - groups
      }`
    );
    const chats = all
      .filter((c) => isIndividualChat(c.id?._serialized) || isGroupChat(c.id?._serialized))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, chatLimit);

    let count = 0;
    for (const chat of chats) {
      try {
        const chatId = chat.id?._serialized;
        if (!chatId) continue;
        const messages = await withTimeout<any[]>(
          // A freshly linked companion already transfers a recent cache for
          // each chat. Do not deep-page every chat during startup; that turns
          // 150 independent network waits into a multi-minute worker boot.
          chat.fetchMessages({ limit: 0 }),
          20000,
          "fetchMessages"
        );
        const recentMessages = messages
          .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
          .slice(-Math.max(1, msgLimit));
        for (const msg of recentMessages) {
          const im = await this.toInbound(msg, {
            downloadAvatar: false,
            resolveQuoted: false,
          });
          if (im) {
            im.historical = true;
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
    console.log(`[whatsapp] backfilled ${count} messages from ${chats.length} chats`);
  }

  send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    mentions?: string[],
    replyToExternalId?: string
  ): Promise<SentMessage> {
    // One native send owns this browser at a time. If its confirmation gets
    // stuck, retiring the client must not interrupt a different active send.
    const sending = this.sendTail.then(() =>
      this.sendExclusive(chatExternalId, body, media, mentions, replyToExternalId)
    );
    this.sendTail = sending.then(() => {}, () => {});
    return sending;
  }

  private async sendExclusive(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    mentions?: string[],
    replyToExternalId?: string
  ): Promise<SentMessage> {
    await this.ensureReady();
    const client = this.client;
    this.activeSends++;
    try {
      return await withTimeout(
        this.sendOnce(chatExternalId, body, media, mentions, replyToExternalId),
        Number(process.env.WHATSAPP_SEND_TIMEOUT_MS || 120_000),
        "WhatsApp delivery confirmation"
      );
    } catch (error) {
      if (error instanceof WhatsAppOperationTimeoutError) {
        if (this.isCurrentClient(client)) {
          this.state = "disconnected";
          this.detail = "Message confirmation stalled; reconnecting";
        }
        // A deadline cannot prove whether WhatsApp sent the message. Shut down
        // the old transport before releasing ownership; never resend here.
        await this.disposeClient(client);
        throw new Error("WhatsApp delivery confirmation timed out. Delivery is unconfirmed; check WhatsApp before retrying.");
      }
      throw error;
    } finally {
      this.activeSends--;
    }
  }

  private async sendOnce(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    mentions?: string[],
    replyToExternalId?: string
  ): Promise<SentMessage> {
    const sendStartedAt = Date.now();
    const quotedMessageId = replyToExternalId
      ? this.messageCache.get(replyToExternalId)?.id?._serialized ||
        (!replyToExternalId.includes(`whatsapp:${chatExternalId}:`)
          ? replyToExternalId.replace(/^whatsapp:/, "")
          : undefined)
      : undefined;
    const mentionedIds = (mentions || [])
      .map((value) => value.replace(/^whatsapp:/, ""))
      .filter((value) => /@(c\.us|lid)$/.test(value));
    let sent: any;
    if (media) {
      const m = MessageMedia.fromFilePath(media.path);
      sent = await this.client.sendMessage(chatExternalId, m, {
        caption: body || undefined,
        sendMediaAsDocument: media.type === "file",
        quotedMessageId,
        ...(mentionedIds.length ? { mentions: mentionedIds } : {}),
      });
    } else {
      sent = await this.client.sendMessage(chatExternalId, body, {
        quotedMessageId,
        ...(mentionedIds.length ? { mentions: mentionedIds } : {}),
      });
    }
    // Some current WhatsApp Web group sends resolve successfully without a
    // serialized message id and do not emit message_create for our own echo.
    // The message is already in the chat's live store, so resolve it there
    // before falling back to an unconfirmed provisional key.
    if (!nativeMessageId(sent)) {
      sent =
        (await this.findRecentSentMessage(
          chatExternalId,
          body,
          sendStartedAt,
          media?.type
        )) || sent;
    }
    return {
      messageExternalId: canonicalMessageExternalId(chatExternalId, sent),
      timestamp: new Date().toISOString(),
    };
  }

  private async findRecentSentMessage(
    chatExternalId: string,
    body: string,
    sentAfter: number,
    mediaType?: MediaType
  ): Promise<any | null> {
    try {
      const chat: any = await this.client.getChatById(chatExternalId);
      if (!chat) return null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const messages = await withTimeout<any[]>(
          // `limit: 0` reads the already-loaded in-page store without invoking
          // whatsapp-web.js's stale history pagination code.
          chat.fetchMessages({ limit: 0 }),
          3_000,
          "sent message lookup"
        );
        const matches = messages
          .filter((candidate) => {
            if (!candidate?.fromMe || !nativeMessageId(candidate)) return false;
            const timestamp = Number(candidate.timestamp || 0) * 1000;
            if (timestamp < sentAfter - 2_000) return false;
            if (String(candidate.body || "") !== body) return false;
            return mediaType
              ? mediaTypeFromWa(String(candidate.type || "")) === mediaType
              : !mediaTypeFromWa(String(candidate.type || ""));
          })
          .sort(
            (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
          );
        if (matches[0]) return matches[0];
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (error) {
      console.error("[whatsapp] sent message id lookup failed:", error);
    }
    return null;
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
      .map((key) => key.replace(/^whatsapp:/, ""))
      .filter((key) => /@(c\.us|lid)$/.test(key));
    if (!participants.length) throw new Error("no WhatsApp participants");
    const result = await this.client.createGroup(name, participants);
    if (typeof result === "string") throw new Error(result);
    const chatExternalId = result.gid?._serialized;
    if (!chatExternalId) throw new Error("WhatsApp created the group without returning its id");

    const participantResults = Object.entries(result.participants || {}).filter(
      ([, value]) => !value.isGroupCreator
    );
    const findResult = (participant: string) => {
      const exact = participantResults.find(([id]) => id === participant);
      if (exact) return exact;
      const phone = participant.replace(/@.*$/, "").replace(/\D/g, "");
      return participantResults.find(
        ([id]) => id.replace(/@.*$/, "").replace(/\D/g, "") === phone
      );
    };

    let inviteUrl: string | undefined;
    const needsFallbackInvite = participants.some((participant) => {
      const found = findResult(participant)?.[1];
      return found && Number(found.statusCode) !== 200 && !found.isInviteV4Sent;
    });
    if (needsFallbackInvite) {
      try {
        const group: any = await this.client.getChatById(chatExternalId);
        const code = await group?.getInviteCode?.();
        if (code) inviteUrl = `https://chat.whatsapp.com/${code}`;
      } catch (error) {
        console.error("[whatsapp] couldn't create a fallback group invite:", error);
      }
    }

    const participantOutcomes = [] as {
      participantKey: string;
      status: "added" | "invite_sent" | "not_added";
      detail?: string;
    }[];
    for (const participant of participants) {
      const nativeResult = findResult(participant)?.[1];
      if (Number(nativeResult?.statusCode) === 200) {
        participantOutcomes.push({
          participantKey: `whatsapp:${participant}`,
          status: "added",
        });
        continue;
      }
      if (nativeResult?.isInviteV4Sent) {
        participantOutcomes.push({
          participantKey: `whatsapp:${participant}`,
          status: "invite_sent",
          detail: "WhatsApp sent a private group invitation.",
        });
        continue;
      }

      let fallbackSent = false;
      if (inviteUrl && Number(nativeResult?.statusCode) !== 404) {
        try {
          await this.client.sendMessage(
            participant,
            `I couldn't add you to “${name}” directly, so here is the group link: ${inviteUrl}`
          );
          fallbackSent = true;
        } catch (error) {
          console.error(
            `[whatsapp] couldn't send group invite to ${participant}:`,
            error
          );
        }
      }
      participantOutcomes.push({
        participantKey: `whatsapp:${participant}`,
        status: fallbackSent ? "invite_sent" : "not_added",
        detail: fallbackSent
          ? "Group link sent in a private WhatsApp message."
          : nativeResult?.message || "WhatsApp could not add or invite this person.",
      });
    }

    return { chatExternalId, inviteUrl, participantOutcomes };
  }

  async resolveDirectContact(target: string): Promise<ResolvedDirectContact> {
    await this.ensureReady();
    const exactId = target.trim().replace(/^whatsapp:/, "");
    if (/@(?:c\.us|lid)$/.test(exactId)) {
      let contact: any;
      try {
        contact = await this.client.getContactById(exactId);
      } catch {
        throw new Error("WhatsApp could not open that tagged person privately.");
      }
      const fallback = exactId.replace(/@.*$/, "");
      const name =
        contact?.pushname || contact?.name || contact?.shortName || "WhatsApp member";
      const handle = contact?.number ? `+${contact.number}` : name;
      const avatarKey = `whatsapp_${exactId}`;
      let avatarUrl = existingAvatar(avatarKey) || undefined;
      if (!avatarUrl) {
        try {
          const picture = await this.client.getProfilePicUrl(exactId);
          if (picture)
            avatarUrl = (await saveAvatarFromUrl(avatarKey, picture)) || undefined;
        } catch {
          // Profile photos are optional and commonly hidden by privacy settings.
        }
      }
      return {
        chatExternalId: exactId,
        externalKey: `whatsapp:${exactId}`,
        name: name || fallback,
        handle,
        avatarUrl,
      };
    }
    const digits = target.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      throw new Error("Enter a WhatsApp number with its country code.");
    }
    const numberId = await this.client.getNumberId(digits);
    const chatExternalId = numberId?._serialized;
    if (!chatExternalId) {
      throw new Error("That number is not registered on WhatsApp.");
    }

    let name = `+${digits}`;
    try {
      const contact: any = await this.client.getContactById(chatExternalId);
      name = contact?.pushname || contact?.name || contact?.shortName || name;
    } catch {
      // The exact number is still messageable even when profile details are private.
    }

    const avatarKey = `whatsapp_${chatExternalId}`;
    let avatarUrl = existingAvatar(avatarKey) || undefined;
    if (!avatarUrl) {
      try {
        const picture = await this.client.getProfilePicUrl(chatExternalId);
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

  async react(
    _chatExternalId: string,
    messageExternalId: string,
    reaction: OutboundReaction
  ): Promise<void> {
    await this.ensureReady();
    const cached = this.messageCache.get(messageExternalId);
    const nativeId = messageExternalId.replace(/^whatsapp:/, "");
    const message = cached || await this.client.getMessageById(nativeId);
    if (!message) throw new Error("WhatsApp could not find that message");
    await message.react(reaction.remove ? "" : reaction.emoji);
  }

  async requestHistory(
    chatExternalId: string,
    _oldestMessageId: string,
    _oldestTimestamp: number,
    count = 100,
    context?: { isGroup?: boolean; sinceTimestamp?: number }
  ): Promise<void> {
    if (!this.onMessage || this.state !== "ready") {
      throw new Error("WhatsApp is not ready");
    }
    const chat = await this.client.getChatById(chatExternalId);
    if (!chat) throw new Error("WhatsApp chat was not found");
    await withTimeout(
      this.loadEarlierMessages(chatExternalId, count, context?.sinceTimestamp),
      30000,
      "message history load"
    );
    const messages = await withTimeout<any[]>(
      // History is already paged into the in-page store above. A zero limit
      // deliberately skips whatsapp-web.js's stale pagination implementation.
      chat.fetchMessages({ limit: 0 }),
      30000,
      "message backfill"
    );
    const recentMessages = messages
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
      .slice(-Math.max(1, Math.min(count, 500)));
    let imported = 0;
    let skipped = 0;
    for (const message of recentMessages) {
      if (
        context?.sinceTimestamp &&
        Number(message.timestamp || 0) * 1000 < context.sinceTimestamp
      ) {
        continue;
      }
      const inbound = await this.toInbound(message);
      if (inbound) {
        inbound.historical = true;
        await this.onMessage(inbound);
        imported++;
      } else {
        skipped++;
      }
    }
    console.log("[whatsapp] history result", JSON.stringify({
      cached: messages.length, processed: imported, skipped,
      newestTimestamp: recentMessages.at(-1)?.timestamp,
    }));
  }

  async recoverMedia(
    chatExternalId: string,
    messageExternalId: string
  ): Promise<void> {
    if (!this.onMessage || this.state !== "ready") {
      throw new Error("WhatsApp is not ready");
    }
    await this.ensureReady();

    const prefix = `whatsapp:${chatExternalId}:`;
    const nativeId = messageExternalId.startsWith(prefix)
      ? messageExternalId.slice(prefix.length)
      : messageExternalId.split(":").at(-1) || "";
    if (!nativeId) throw new Error("WhatsApp message ID is invalid");

    let message = this.messageCache.get(messageExternalId);
    if (!message) {
      const chat: any = await this.client.getChatById(chatExternalId);
      if (!chat) throw new Error("WhatsApp chat was not found");

      const findCachedMessage = async () => {
        const cached = await withTimeout<any[]>(
          chat.fetchMessages({ limit: 0 }),
          30_000,
          "attachment lookup"
        );
        return cached.find(
          (candidate) =>
            candidate?.id?.id === nativeId ||
            canonicalMessageExternalId(chatExternalId, candidate) ===
              messageExternalId
        );
      };

      message = await findCachedMessage();
      if (!message) {
        await withTimeout(
          this.loadEarlierMessages(chatExternalId, 500),
          45_000,
          "attachment history load"
        );
        message = await findCachedMessage();
      }
    }
    if (!message) {
      throw new Error(
        "WhatsApp no longer has this message in the linked device history."
      );
    }
    if (!message.hasMedia) {
      throw new Error("WhatsApp did not include an attachment on this message.");
    }

    let recovered: InboundMessage | null;
    const refreshedMedia = await this.refreshExpiredMedia(
      chatExternalId,
      nativeId
    );
    try {
      const directMedia = await this.downloadResolvedMedia(
        refreshedMedia,
        messageExternalId
      );
      recovered = await this.toInbound(message, { downloadMedia: false });
      if (!recovered) {
        throw new Error("WhatsApp returned an unreadable message.");
      }
      recovered.media = directMedia;
    } catch (directError) {
      const detail =
        directError instanceof Error ? directError.message : String(directError);
      throw new Error(
        refreshedMedia.stage === "RESOLVED"
          ? `WhatsApp refreshed the attachment, but Omni could not save it: ${detail}`
          : `WhatsApp could not refresh this attachment from the phone: ${detail}`
      );
    }
    if (!recovered?.media?.url) {
      throw new Error(
        "WhatsApp could not download this attachment. It may have expired."
      );
    }
    recovered.historical = true;
    await this.onMessage(recovered);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.readPoll) clearInterval(this.readPoll);
    this.readPoll = undefined;
    if (this.healthPoll) clearInterval(this.healthPoll);
    this.healthPoll = undefined;
    await this.disposeClient(this.client);
    this.state = "disconnected";
  }
}
