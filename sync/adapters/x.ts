import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "puppeteer";
import puppeteer, { REAL_UA } from "../x-browser";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import { cleanChromeLocks, HARDENED_CHROME_ARGS } from "../chrome-locks";
import { chromeProxyServer, proxyArgs } from "../proxy";
import { FingerprintGenerator } from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  OutboundMedia,
  SentMessage,
} from "./types";

/* X has no affordable DM API and heavy bot detection, so this drives a real
   logged-in browser session (cookies from `npm run x:login`) and reads the
   rendered DM DOM. Selectors live in the page.evaluate blocks below and may
   need tuning when X changes its markup. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const AUTH_FILE = path.join(process.cwd(), ".x_auth", "cookies.json");

// Cookies either come from `npm run x:login` (saved file) or, to bypass X's
// login bot-detection, are imported straight from a real browser session via
// X_AUTH_TOKEN + X_CT0 env vars (copy from DevTools → Application → Cookies).
function loadCookies(): any[] | null {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    } catch {
      /* fall through to env */
    }
  }
  const token = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (token && ct0) {
    return [
      { name: "auth_token", value: token, domain: ".x.com", path: "/", httpOnly: true, secure: true },
      { name: "ct0", value: ct0, domain: ".x.com", path: "/", secure: true },
    ];
  }
  return null;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A consistent, realistic browser fingerprint — generated once and persisted,
// so it doesn't change every launch (a fingerprint that shifts each run is
// itself a detection signal). Layered on top of the stealth plugin.
function loadOrCreateFingerprint(): any {
  const dir = process.env.DATA_DIR || process.cwd();
  const file = path.join(dir, ".x_fingerprint.json");
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* regenerate below */
  }
  const fp = new FingerprintGenerator({
    browsers: [{ name: "chrome", minVersion: 120 }],
    operatingSystems: ["macos", "windows"],
    devices: ["desktop"],
    locales: ["en-CA", "en-US"],
  }).getFingerprint();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(fp));
  } catch {
    /* non-fatal */
  }
  return fp;
}

interface ScrapedConversation {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
}
interface ScrapedMessage {
  id: string;
  direction: "in" | "out";
  text: string;
}

export class XAdapter implements Adapter {
  platform = "x" as const;
  private browser?: Browser;
  private page?: Page;
  private state: AdapterStatus["state"] = "starting";
  private detail?: string;
  private busy = false;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private reconnecting = false;
  private proxyUrl?: string;

  // Per-account ready: pass the account's proxy. Falls back to global PROXY_URL.
  constructor(opts: { proxyUrl?: string } = {}) {
    this.proxyUrl = opts.proxyUrl;
  }

  getStatus(): AdapterStatus {
    return { platform: "x", state: this.state, detail: this.detail };
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    this.onMessage = onMessage;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const cookies = loadCookies();
    if (!cookies) {
      this.state = "disconnected";
      console.log(
        "[x] no session — run `npm run x:login`, or set X_AUTH_TOKEN + X_CT0 from your browser cookies."
      );
      return;
    }

    const profileDir = path.join(
      process.env.DATA_DIR || process.cwd(),
      ".x_profile"
    );
    cleanChromeLocks(profileDir);
    try {
      await this.browser?.close();
    } catch {
      /* already gone */
    }

    const proxy = await chromeProxyServer(this.proxyUrl);
    this.browser = await puppeteer.launch({
      headless: true,
      timeout: 60000,
      // Persistent profile so the XChat passcode unlock (done once, headful,
      // via `npm run x:unlock`) carries over and stays decrypted here.
      userDataDir: profileDir,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      channel: (process.env.X_CHROME_CHANNEL as any) || undefined,
      args: [
        ...HARDENED_CHROME_ARGS,
        ...proxyArgs(proxy),
        "--disable-blink-features=AutomationControlled",
      ],
    });

    // If the browser process dies, recover.
    this.browser.on("disconnected", () => {
      if (this.state === "ready") {
        console.error("[x] browser disconnected");
        this.scheduleReconnect();
      }
    });

    this.page = await this.browser.newPage();
    // Inject a consistent realistic fingerprint (UA, viewport, navigator/WebGL
    // overrides) on top of the stealth plugin — best free anti-detect for X.
    try {
      await new FingerprintInjector().attachFingerprintToPuppeteer(
        this.page,
        loadOrCreateFingerprint()
      );
    } catch (e) {
      console.error("[x] fingerprint inject failed, using default UA:", e);
      await this.page.setUserAgent(REAL_UA);
      await this.page.setViewport({ width: 1280, height: 900 });
    }
    await this.page.setCookie(...cookies);
    this.page.on("error", (err) => {
      console.error("[x] page error:", err.message);
      this.scheduleReconnect();
    });

    await this.page.goto("https://x.com/i/chat", {
      waitUntil: "domcontentloaded",
    });
    await delay(7000);

    const url = this.page.url();
    if (url.includes("/login") || url.includes("/i/flow")) {
      this.state = "disconnected";
      console.error("[x] session invalid/expired — refresh X_AUTH_TOKEN/X_CT0.");
      return;
    }
    if (/pin|passcode|recovery/i.test(url)) {
      this.state = "disconnected";
      this.detail = "XChat locked";
      console.error("[x] XChat is locked — run `npm run x:unlock` and enter your passcode once.");
      return;
    }
    this.state = "ready";
    this.detail = undefined; // clear any prior "XChat locked"
    console.log("[x] live (XChat loaded)");

    const onMessage = this.onMessage!;
    if (process.env.SYNC_BACKFILL !== "0") {
      await this.sync(onMessage).catch((e) =>
        console.error("[x] backfill error:", e)
      );
    }

    // Single poll loop — clear any previous one first so reconnects don't stack.
    if (this.timer) clearInterval(this.timer);
    const everyMs = Number(process.env.X_POLL_MS || 20000);
    this.timer = setInterval(() => {
      this.sync(onMessage).catch((e) => console.error("[x] poll error:", e));
    }, everyMs);
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.state = "disconnected";
    if (this.timer) clearInterval(this.timer);
    console.log("[x] reconnecting in 10s…");
    setTimeout(() => {
      this.reconnecting = false;
      this.connect().catch((e) => console.error("[x] reconnect failed:", e));
    }, 10000);
  }

  // Reads the conversation list, then each conversation's messages, and feeds
  // them to the store (deduped by a content hash).
  private async sync(
    onMessage: (m: InboundMessage) => Promise<void>
  ): Promise<void> {
    if (!this.page || this.busy) return;
    this.busy = true;
    try {
      const chatLimit = Number(process.env.X_BACKFILL_CHATS || 20);
      await this.page.goto("https://x.com/i/chat", {
        waitUntil: "domcontentloaded",
      });
      await delay(4000);
      if (/pin|passcode|recovery/i.test(this.page.url())) {
        this.state = "disconnected";
        this.detail = "XChat locked";
        console.error("[x] XChat locked — run `npm run x:unlock`.");
        return;
      }
      const conversations = await this.scrapeConversations();
      console.log(`[x] ${conversations.length} conversations`);

      for (const conv of conversations.slice(0, chatLimit)) {
        const avatarKey = `x_${conv.id}`;
        let avatarUrl = existingAvatar(avatarKey) || undefined;
        if (!avatarUrl && conv.avatar) {
          avatarUrl = (await saveAvatarFromUrl(avatarKey, conv.avatar)) || undefined;
        }

        const messages = await this.scrapeMessages(conv.id);
        let i = 0;
        const now = Date.now();
        for (const msg of messages) {
          if (!msg.text) continue;
          await onMessage({
            platform: "x",
            chatExternalId: conv.id,
            // Each XChat message has a stable UUID — ideal for dedupe.
            messageExternalId: `x:${msg.id}`,
            direction: msg.direction,
            body: msg.text,
            // Preserve order; first-seen time sticks (dedupe skips re-syncs).
            timestamp: new Date(now - (messages.length - i) * 1000),
            contact: {
              externalKey: `x:${conv.id}`,
              name: conv.name || "X user",
              handle: conv.handle || conv.name || conv.id,
              avatarUrl,
            },
          });
          i++;
        }
      }
    } catch (e) {
      const s = String(e);
      if (/detached|Target closed|Session closed|Connection closed|Protocol error/i.test(s)) {
        console.error("[x] page lost during sync:", s);
        this.scheduleReconnect();
      } else {
        throw e;
      }
    } finally {
      this.busy = false;
    }
  }

  private async scrapeConversations(): Promise<ScrapedConversation[]> {
    if (!this.page) return [];
    // The inbox list lazy-loads; scroll it to pull in more conversations.
    for (let k = 0; k < 6; k++) {
      await this.page.evaluate(() => {
        const list =
          document.querySelector('[data-testid="dm-inbox-panel"]') ||
          document.querySelector('[data-testid="dm-container"]');
        if (list) (list as HTMLElement).scrollTop = (list as HTMLElement).scrollHeight;
      });
      await delay(700);
    }
    return this.page.evaluate(() => {
      const out: {
        id: string;
        name: string;
        handle: string;
        avatar?: string;
      }[] = [];
      const seen = new Set<string>();
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/i/chat/"]')
      ) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const id = href.replace("/i/chat/", "").split("/")[0];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const lines = ((a as HTMLElement).innerText || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        // Lines look like: [Name, "27m", "preview..."]; first line is the name.
        const name = lines[0] || id;
        const img = a.querySelector("img") as HTMLImageElement | null;
        out.push({ id, name, handle: "", avatar: img?.src });
      }
      return out;
    });
  }

  private async scrapeMessages(conversationId: string): Promise<ScrapedMessage[]> {
    if (!this.page) return [];
    await this.page.goto(`https://x.com/i/chat/${conversationId}`, {
      waitUntil: "domcontentloaded",
    });
    await delay(3500);
    // Message list virtualizes — scroll to top repeatedly to load history.
    const scrollRounds = Number(process.env.X_HISTORY_SCROLLS || 8);
    for (let k = 0; k < scrollRounds; k++) {
      await this.page.evaluate(() => {
        const c =
          document.querySelector('[data-testid="dm-message-list-container"]') ||
          document.querySelector('[data-testid="dm-message-list"]');
        if (c) (c as HTMLElement).scrollTop = 0;
      });
      await delay(700);
    }
    return this.page.evaluate(() => {
      const list =
        (document.querySelector('[data-testid="dm-message-list"]') as HTMLElement) ||
        (document.querySelector('[data-testid="dm-message-list-container"]') as HTMLElement);
      const listRect = list?.getBoundingClientRect();
      const mid = listRect ? listRect.left + listRect.width / 2 : window.innerWidth / 2;

      const texts = Array.from(
        document.querySelectorAll('[data-testid^="message-text-"]')
      ) as HTMLElement[];

      return texts.map((el) => {
        const testid = el.getAttribute("data-testid") || "";
        const id = testid.replace("message-text-", "");
        // Outgoing bubbles hug the right: compare the text's center to the
        // message list's center.
        const r = el.getBoundingClientRect();
        const center = r.left + r.width / 2;
        const direction: "in" | "out" = center > mid ? "out" : "in";
        // The bubble's innerText trails the time (sometimes twice) — strip it.
        const text = (el.innerText || "")
          .replace(/(\s*\d{1,2}:\d{2}\s*(AM|PM))+\s*$/i, "")
          .trim();
        return { id, direction, text };
      });
    });
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia
  ): Promise<SentMessage> {
    if (!this.page) throw new Error("X not ready");
    this.busy = true;
    try {
      await this.page.goto(`https://x.com/i/chat/${chatExternalId}`, {
        waitUntil: "domcontentloaded",
      });
      await delay(3000);
      const input =
        (await this.page.$('[data-testid="dm-conversation-panel"] [contenteditable="true"]')) ||
        (await this.page.$('[data-testid="dm-conversation-panel"] [role="textbox"]')) ||
        (await this.page.$('[data-testid="dmComposerTextInput"]'));
      if (!input) throw new Error("XChat composer not found");

      // Attach a photo/video by driving the hidden file input, then wait for
      // the preview to attach before sending.
      if (media) {
        const fileInput = (await this.page.$(
          'input[data-testid="fileInput"]'
        )) || (await this.page.$('input[type="file"]'));
        if (!fileInput) throw new Error("X file input not found");
        await (fileInput as any).uploadFile(media.path);
        await delay(2500);
      }

      await input.click();
      if (body) await this.page.keyboard.type(body, { delay: 15 });
      await this.page.keyboard.press("Enter");
      await delay(1500);
      return {
        messageExternalId: `x:${chatExternalId}:${hash("out|" + body + "|" + Date.now())}`,
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    await this.browser?.close();
  }
}
