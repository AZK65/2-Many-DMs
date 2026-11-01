import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accountStoragePath, xSessionCookies } from "../account-session";
import type { Browser, Page } from "puppeteer";
import puppeteer, { REAL_UA } from "../x-browser";
import { existingAvatar, saveAvatarFromUrl } from "../avatars";
import { XAvatarSources } from "../x-avatar-sources";
import { cleanChromeLocks, HARDENED_CHROME_ARGS } from "../chrome-locks";
import { chromeProxyServer, proxyArgs } from "../proxy";
import { isLocked, tryUnlock, type UnlockResult } from "../x-passcode";
import { isXRateLimitRelevant, xRateLimitTransition, xRetryDeadline } from "../x-rate-limit";
import { mergeXHistory, orderXMinuteMessages, parseXDate, parseXMessageInfoDate, stableXInboxDate, xInboxDateIsEstimate, xSnowflakeDate, xHistoryMatchesPreview, type XLatestPreview } from "../x-history";
import { prisma, reconcileXConversationTime } from "../store";
import { scrollXSurface } from "../x-dom-scroll";
import { readXMessageDom, readXAttachmentBytes } from "../x-message-dom";
import { downloadNativeXVoice, readNativeXMessageTime } from "../x-native-media";
import { coalesceXPreviewRuns, reconcileXPreviewCopies, reconcileXVerifiedSnapshot, reconcileXAccountPreviews, xSnapshotProofs } from "../x-preview-reconciliation";
import { MAX_BYTES, extFromMime, saveMedia } from "../media";
import { waitForXSendConfirmation, type XSendConfirmation } from "../x-send-confirmation";
import { normalizeXMessageText } from "../x-message-text";
import { mutateXMessage } from "../x-message-mutations";
import { isNativeXMutationKey, MessageMutationRejected, type MessageMutationAction } from "../../src/lib/message-mutations";
import type {
  Adapter,
  AdapterStatus,
  InboundMessage,
  OutboundMedia,
  OutboundSendContext,
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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// XChat now renders its entire inbox inside a shadow root. Puppeteer's
// `pierce/` query handler crosses that boundary for trusted clicks and file
// uploads; page.evaluate callbacks use the equivalent root lookup below.
const xchatSelector = (selector: string) => `pierce/${selector}`;

interface ScrapedConversation {
  id: string;
  name: string;
  handle: string;
  preview: string;
  direction: "in" | "out";
  unread: boolean;
  inboxCategory: "general" | "spam";
  avatar?: string;
  timestamp?: number | null;
  timeLabel?: string;
}
interface ScrapedMessage {
  id: string;
  direction: "in" | "out";
  text: string;
  timestamp?: number | null;
  minutePrecision?: boolean;
  attachments?: NonNullable<InboundMessage["media"]>[];
}

interface AutomaticRepair {
  id: string;
  name: string;
  inboxCategory: "general" | "spam";
  previewKey: string;
  attempts: number;
  live?: boolean;
  activityAt?: number;
}

function previewSignature(conversation: ScrapedConversation): string {
  const mediaVersion = /(?:sent|shared) (?:(?:a|an|\d+) )?(?:photo|image|video|gif|voice|audio|attachment|file|document)/i.test(conversation.preview) ? "media-v2:" : "";
  return `${mediaVersion}${conversation.direction}:${conversation.preview}:${conversation.timestamp || "undated"}`;
}

export class XAdapter implements Adapter {
  platform = "x" as const;
  private browser?: Browser;
  // Keep only the two inbox views mounted so XChat's live updates can arrive
  // without full navigations every poll. History and sending pages stay blank
  // until the user explicitly asks for either action; four live XChat routes
  // were enough to trigger X's browser rate limiter during normal CRM use.
  private page?: Page;
  private requestPage?: Page;
  private chatPage?: Page;
  private sendPage?: Page;
  private state: AdapterStatus["state"] = "starting";
  private detail?: string;
  private busy = false;
  private onMessage?: (m: InboundMessage) => Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private liveTimer?: ReturnType<typeof setInterval>;
  private liveRead?: Promise<void>;
  private previewWrites: Promise<void> = Promise.resolve();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnecting = false;
  private connectPromise?: Promise<void>;
  private lifecycleVersion = 0;
  private cooldownParkPromise?: Promise<void>;
  private stopping = false;
  // Incrementing this cancels the remainder of a background scrape. Sending
  // gets priority so a poll cannot navigate the shared page away from the
  // composer while a message is being delivered.
  private pageRun = 0;
  private conversationPreviews = new Map<string, string>();
  private avatarSources: XAvatarSources;

  async refreshAvatar(chatExternalId: string): Promise<import("./types").AvatarRefreshResult> {
    this.assertNotCoolingDown();
    // Reuse photos observed during normal inbox sync. Never navigate a chat
    // or bypass X's request pacing just to retrieve a profile picture.
    const source = this.avatarSources.get(chatExternalId);
    if (source) {
      const url = await saveAvatarFromUrl(`x_${chatExternalId}`, source);
      if (!url) throw new Error("Avatar download failed");
      return { url, source: "downloaded" };
    }
    const url = existingAvatar(`x_${chatExternalId}`, "jpg", true);
    return url ? { url, source: "cached" } : { source: "unavailable" };
  }
  private inboxRetryAt = 0;
  private inboxFailures = 0;
  private rateLimitFailures = 0;
  private lastHttp429At = 0;
  private lastRateLimitAt = 0;
  private rateLimitUntil = 0;
  private lastInboxNavigationAt = 0;
  private lastRequestNavigationAt = 0;
  private lastHistoryRequestAt = 0;
  private automaticRepairQueue = new Map<string, AutomaticRepair>();
  private repairedPreviews = new Map<string, string>();
  private repairStateLoaded = false;
  private automaticRepairTimer?: ReturnType<typeof setTimeout>;
  private automaticRepairRunning = false;
  private automaticRepairNextAt = Date.now() + 60_000;
  private sendPageIdleTimer?: ReturnType<typeof setTimeout>;
  private reconnectFailures = 0;
  private proxyUrl?: string;
  private outboundQueue: Promise<void> = Promise.resolve();
  private outboundPending = 0;
  private accountId?: string;
  private session?: { authToken: string; ct0: string; passcode?: string };
  private discoveryOffsets = { general: 0, spam: 0 };
  private inboxDates = new Map<string, { preview: string; timestamp: number }>();
  private repairRetryAt = new Map<string, number>();
  private lastRepairAt = new Map<string, number>();
  private lastHistoryAuditAt = 0;
  private lastInboxCheckedAt = 0;
  private attachmentCache = new Map<string, NonNullable<InboundMessage["media"]>>();
  private attachmentRetryAt = new Map<string, number>();
  private nativeMessageTimes = new Map<string, number>();
  private nativeTimeRetryAt = new Map<string, number>();

  // Per-account ready: pass the account's proxy. Falls back to global PROXY_URL.
  constructor(opts: { proxyUrl?: string; accountId?: string; session?: { authToken: string; ct0: string; passcode?: string } } = {}) {
    this.proxyUrl = opts.proxyUrl;
    this.accountId = opts.accountId;
    this.avatarSources = new XAvatarSources(opts.accountId ? path.join(process.env.DATA_DIR || process.cwd(),
      ".local", `x-avatar-sources-${opts.accountId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`) : undefined);
    this.session = opts.session;
  }

  private storagePath(name: string) {
    return accountStoragePath(process.env.DATA_DIR || process.cwd(), name, this.session ? this.accountId : undefined);
  }

  getStatus(): AdapterStatus {
    if (this.state === "ready" && !this.stopping && (
      !this.browser?.connected ||
      [this.page, this.requestPage, this.chatPage, this.sendPage].some((page) => !page || page.isClosed())
    )) this.scheduleReconnect();
    const now = Date.now();
    const chats = new Map<string, import("../../src/lib/sync-health").ChatSyncIssue>();
    for (const repair of this.automaticRepairQueue.values()) chats.set(repair.id, { externalId: repair.id, state: "queued" });
    for (const [key, retryAt] of this.repairRetryAt) if (retryAt > now) {
      const externalId = key.replace(/^(general|spam):/, "");
      chats.set(externalId, { externalId, state: "blocked", retryAt });
    }
    return {
      platform: "x",
      state: this.state === "ready" && Date.now() < this.inboxRetryAt ? "starting" : this.state,
      detail: this.detail || (this.automaticRepairQueue.size ? `X connected · repairing ${this.automaticRepairQueue.size} chats in the background` : undefined),
      sync: { lastCheckedAt: this.lastInboxCheckedAt || undefined, retryAt: this.inboxRetryAt,
        pendingChats: [...chats.values()].filter(c => c.state === "queued").length,
        blockedChats: [...chats.values()].filter(c => c.state === "blocked").length, chats: [...chats.values()] },
    };
  }

  async ensureReady(): Promise<void> {
    this.assertNotCoolingDown();
    if (
      this.state !== "ready" ||
      !this.page ||
      this.page.isClosed() ||
      !this.chatPage ||
      this.chatPage.isClosed() ||
      !this.sendPage ||
      this.sendPage.isClosed()
    ) {
      throw new Error("X is reconnecting");
    }
  }

  async recover(): Promise<void> {
    if (this.stopping) return;
    // A healthy browser in a server cooldown needs quiet time, not a new
    // browser session. Manual recovery must respect the same circuit breaker.
    if (Date.now() < this.inboxRetryAt && this.browser?.connected && this.page && !this.page.isClosed()) {
      await this.parkForCooldown();
      return;
    }
    this.state = "starting";
    await this.connect().catch((error) => {
      console.error("[x] recovery failed:", error);
      this.scheduleReconnect();
    });
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    this.stopping = false;
    this.onMessage = onMessage;
    this.loadRepairState();
    if (this.accountId) {
      try {
        const report = await reconcileXAccountPreviews(prisma, this.accountId, xSnapshotProofs(this.repairedPreviews, this.lastRepairAt));
        if (report.removed) console.log(`[x] repaired ${report.removed} saved preview copies across ${report.changed}/${report.scanned} chats; recovery copies saved`);
      } catch (error) {
        console.warn("[x] saved preview repair deferred; existing messages preserved:", error);
      }
    }
    await this.connect().catch((error) => {
      console.error("[x] initial connection failed:", error);
      this.scheduleReconnect();
    });
  }

  private cooldownFile(): string {
    return this.storagePath(".x_cooldown.json");
  }

  private repairStateFile(): string {
    return this.storagePath(".x_repair_state.json");
  }

  private loadRepairState(): void {
    if (this.repairStateLoaded) return;
    this.repairStateLoaded = true;
    try {
      const saved = JSON.parse(fs.readFileSync(this.repairStateFile(), "utf8")) as {
        version?: number;
        previews?: Record<string, string>;
        observations?: Array<[string, string]>;
        queue?: Array<[string, AutomaticRepair]>;
        dates?: Array<[string, { preview: string; timestamp: number }]>;
        retryAt?: Array<[string, number]>;
        offsets?: { general: number; spam: number };
        lastRepairAt?: Array<[string, number]>;
        lastHistoryAuditAt?: number;
      };
      if (saved.version !== 2) return; // Old checkpoints marked partial viewport reads as complete.
      for (const [key, value] of Object.entries(saved.previews || {})) {
        if (typeof value === "string") this.repairedPreviews.set(key, value);
      }
      for (const [key, signature] of saved.observations || []) {
        if (typeof signature === "string") this.conversationPreviews.set(key, signature);
      }
      for (const [key, repair] of saved.queue || []) {
        if (repair?.id && typeof repair.previewKey === "string") this.automaticRepairQueue.set(key, repair);
      }
      this.inboxDates = new Map(saved.dates || []);
      this.repairRetryAt = new Map(saved.retryAt || []);
      this.lastRepairAt = new Map(saved.lastRepairAt || []);
      this.lastHistoryAuditAt = saved.lastHistoryAuditAt || 0;
      if (saved.offsets) this.discoveryOffsets = saved.offsets;
    } catch {
      // The first low-traffic repair run starts without a checkpoint.
    }
  }

  private persistRepairState(): void {
    try {
      const target = this.repairStateFile();
      fs.writeFileSync(`${target}.tmp`, JSON.stringify({ version: 2, previews: Object.fromEntries(this.repairedPreviews), observations: [...this.conversationPreviews], queue: [...this.automaticRepairQueue], dates: [...this.inboxDates], retryAt: [...this.repairRetryAt], offsets: this.discoveryOffsets, lastRepairAt: [...this.lastRepairAt], lastHistoryAuditAt: this.lastHistoryAuditAt }));
      fs.renameSync(`${target}.tmp`, target);
    } catch {
      // A read-only install can still use the in-memory queue for this run.
    }
  }

  private browserPidFile(): string {
    return this.storagePath(".x_browser_pid");
  }

  private browserProcessOwnsProfile(pid: number, profileDir: string): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 1) return false;
    const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    });
    const command = result.stdout || "";
    return (
      command.includes(`--user-data-dir=${profileDir}`) &&
      /(?:Google Chrome|Chromium)/.test(command)
    );
  }

  private profileBrowserPids(profileDir: string): number[] {
    const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
      encoding: "utf8",
    });
    const marker = `--user-data-dir=${profileDir}`;
    return (result.stdout || "")
      .split("\n")
      .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
      .filter(
        (match): match is RegExpMatchArray =>
          Boolean(
            match &&
              match[2].includes(marker) &&
              /(?:Google Chrome|Chromium)/.test(match[2]) &&
              !match[2].includes("--type=")
          )
      )
      .map((match) => Number(match[1]))
      .filter((pid) => Number.isSafeInteger(pid) && pid > 1);
  }

  private async terminateSavedBrowser(profileDir: string): Promise<void> {
    const pidFile = this.browserPidFile();
    let savedPid = 0;
    try {
      savedPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    } catch {
      // A worker can be killed before writing or clearing the PID file. The
      // process scan below is the authoritative cleanup path.
    }

    const pids = new Set(this.profileBrowserPids(profileDir));
    if (this.browserProcessOwnsProfile(savedPid, profileDir)) pids.add(savedPid);
    for (const pid of pids) {
      console.log(`[x] closing orphaned browser process ${pid}`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // It exited between the process check and the signal.
      }
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(100);
      if (
        [...pids].every(
          (pid) => !this.browserProcessOwnsProfile(pid, profileDir)
        )
      )
        break;
    }
    for (const pid of pids) {
      if (this.browserProcessOwnsProfile(pid, profileDir)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // It exited during the final check.
        }
      }
    }
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // Already removed.
    }
  }

  private saveBrowserPid(browser: Browser): void {
    const pid = browser.process()?.pid;
    if (!pid) return;
    try {
      fs.writeFileSync(this.browserPidFile(), String(pid));
    } catch {
      // Shutdown still uses Puppeteer's browser handle when the file is read-only.
    }
  }

  private clearBrowserPid(pid?: number): void {
    try {
      const savedPid = Number(fs.readFileSync(this.browserPidFile(), "utf8").trim());
      if (!pid || savedPid === pid) fs.unlinkSync(this.browserPidFile());
    } catch {
      // Already removed.
    }
  }

  private restoreRateLimitCooldown(): void {
    try {
      const saved = JSON.parse(fs.readFileSync(this.cooldownFile(), "utf8")) as {
        retryAt?: number;
        failures?: number;
        lastRateLimitAt?: number;
      };
      const savedRetryAt = Number(saved.retryAt) || 0;
      this.lastRateLimitAt = Math.max(
        0,
        Number(saved.lastRateLimitAt) || (savedRetryAt > Date.now() ? Date.now() : 0)
      );
      if (
        this.lastRateLimitAt > Date.now() - 6 * 60 * 60 * 1000
      ) {
        this.rateLimitFailures = Math.max(1, Number(saved.failures) || 1);
      }
      if (savedRetryAt > Date.now()) {
        this.inboxRetryAt = savedRetryAt;
        this.rateLimitUntil = savedRetryAt;
        this.rateLimitFailures = Math.max(1, this.rateLimitFailures);
        this.detail = `X inbox paused to protect the account until ${new Date(
          this.inboxRetryAt
        ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      }
    } catch {
      // No saved cooldown (or an old invalid file) is the normal first-run case.
    }
  }

  private persistRateLimitCooldown(): void {
    try {
      fs.writeFileSync(
        this.cooldownFile(),
        JSON.stringify({
          retryAt: this.inboxRetryAt,
          failures: this.rateLimitFailures,
          lastRateLimitAt: this.lastRateLimitAt,
        })
      );
    } catch {
      // A read-only install still gets the in-memory circuit breaker.
    }
  }

  private markRateLimited(resetAt?: number): void {
    const transition = xRateLimitTransition(
      { retryAt: this.rateLimitUntil, failures: this.rateLimitFailures },
      resetAt || 0,
      Date.now(),
      Number(process.env.X_RATE_LIMIT_BASE_MS || 15 * 60 * 1000)
    );
    this.rateLimitFailures = transition.failures;
    this.rateLimitUntil = transition.retryAt;
    this.inboxRetryAt = Math.max(this.inboxRetryAt, transition.retryAt);
    if (transition.newStrike) this.lastRateLimitAt = Date.now();
    this.detail = `X inbox paused to protect the account until ${new Date(
      this.inboxRetryAt
    ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    this.persistRateLimitCooldown();
    // Stopping our poll timer alone does not stop XChat's own requests. Blank
    // the mounted routes so the server's cooldown can actually elapse.
    void this.parkForCooldown();
    console.error(
      `[x] HTTP 429 received; inbox circuit open until ${new Date(
        this.inboxRetryAt
      ).toISOString()}`
    );
  }

  private watchForRateLimits(page: Page): void {
    page.on("response", (response) => {
      if (this.stopping || page.browser() !== this.browser || response.status() !== 429) return;
      const resourceType = response.request().resourceType();
      const url = response.url();
      if (!isXRateLimitRelevant(url, resourceType)) return;
      const now = Date.now();
      // Every response may carry a later server reset; the circuit breaker
      // counts these as one strike for the entire active cooldown.
      this.lastHttp429At = now;
      const retryAt = xRetryDeadline(response.headers(), now);
      console.warn(`[x] rate limit on ${new URL(url).pathname}`);
      this.markRateLimited(retryAt || undefined);
    });
  }

  private assertNotCoolingDown(): void {
    if (Date.now() < this.inboxRetryAt) {
      throw new Error(`X is cooling down until ${new Date(this.inboxRetryAt).toLocaleTimeString([], {
        hour: "numeric", minute: "2-digit",
      })}; messages will resume after X allows requests`);
    }
  }

  private parkForCooldown(): Promise<void> {
    if (this.cooldownParkPromise) return this.cooldownParkPromise;
    // Let an already-clicked send finish confirmation before retiring its
    // pages. send()'s finally block parks them as soon as that operation ends.
    const pages = this.outboundPending > 0
      ? [this.page, this.chatPage]
      : [this.page, this.requestPage, this.chatPage, this.sendPage];
    const park = async (page: Page | undefined) => {
      await this.parkActionPage(page);
      // An unresponsive route must not be left issuing background requests
      // after its blank navigation failed. Liveness supervision will recreate
      // closed pages in a blank browser while preserving the saved cooldown.
      if (page && !page.isClosed() && page.url() !== "about:blank") {
        await page.close().catch(() => null);
      }
    };
    const parking = Promise.allSettled(pages.map(park))
      .then(async () => {
        // A send may settle while the inbox pages are still being parked.
        if (this.outboundPending === 0) {
          await Promise.allSettled([this.requestPage, this.sendPage].map(park));
        }
      })
      .finally(() => {
        if (this.cooldownParkPromise === parking) this.cooldownParkPromise = undefined;
      });
    this.cooldownParkPromise = parking;
    return parking;
  }

  private connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    const attempt = this.connectOnce().finally(() => {
      if (this.connectPromise === attempt) this.connectPromise = undefined;
    });
    this.connectPromise = attempt;
    return attempt;
  }

  private async connectOnce(): Promise<void> {
    if (this.stopping) return;
    const lifecycle = ++this.lifecycleVersion;
    const isCurrent = () => !this.stopping && lifecycle === this.lifecycleVersion;
    this.state = "starting";
    this.pageRun += 1;
    this.busy = false;
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = undefined;
    this.reconnectTimer = undefined;
    this.reconnecting = false;
    this.restoreRateLimitCooldown();
    this.loadRepairState();
    const cookies = this.session ? xSessionCookies(this.session) : loadCookies();
    if (!cookies) {
      this.state = "disconnected";
      console.log(
        "[x] no session — run `npm run x:login`, or set X_AUTH_TOKEN + X_CT0 from your browser cookies."
      );
      return;
    }

    const profileDir = this.storagePath(".x_profile");
    const previousBrowser = this.browser;
    this.browser = undefined;
    try {
      await previousBrowser?.close();
    } catch {
      /* already gone */
    }
    await this.terminateSavedBrowser(profileDir);
    if (!isCurrent()) return;
    cleanChromeLocks(profileDir);

    const proxy = await chromeProxyServer(this.proxyUrl);
    if (!isCurrent()) return;
    const browser = await puppeteer.launch({
      headless: true,
      timeout: 60000,
      protocolTimeout: 45000,
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
    if (!isCurrent()) {
      await browser.close().catch(() => null);
      return;
    }
    this.browser = browser;
    this.saveBrowserPid(browser);
    // A persistent Chrome profile can restore routes from a crashed worker.
    // Keep only pages owned by this adapter so orphaned tabs cannot continue
    // polling X outside our saved cooldown or response monitoring.
    const restoredPages = await browser.pages();
    await Promise.allSettled(restoredPages.map((page) => page.close()));
    if (!isCurrent()) return;

    // If the browser process dies, recover.
    browser.on("disconnected", () => {
      this.clearBrowserPid(browser.process()?.pid);
      if (isCurrent() && this.browser === browser) {
        console.error("[x] browser disconnected");
        this.scheduleReconnect();
      }
    });

    this.page = await this.browser.newPage();
    // Use a stable viewport and the actual local Chrome version.
    await this.configurePage(this.page);
    if (!isCurrent()) return;
    await this.page.setCookie(...cookies);
    this.watchForRateLimits(this.page);
    this.page.on("error", (err) => {
      if (!isCurrent()) return;
      console.error("[x] inbox page error:", err.message);
      this.scheduleReconnect();
    });

    let inboxLoaded = false;
    if (Date.now() >= this.inboxRetryAt) {
      try {
        this.lastInboxNavigationAt = Date.now();
        await this.page.goto("https://x.com/i/chat", {
          waitUntil: "domcontentloaded",
        });
        await delay(5000);
        inboxLoaded = true;
      } catch (error) {
        if (!isCurrent()) return;
        // A 429 handler may have deliberately parked this route while goto
        // was in flight. Preserve its server deadline instead of overwriting
        // it with the shorter generic network retry.
        if (Date.now() >= this.rateLimitUntil) {
          const retryMs = Math.max(
            5 * 60 * 1000,
            Number(process.env.X_INBOX_RECOVERY_MS || 10 * 60 * 1000)
          );
          this.inboxRetryAt = Date.now() + retryMs;
          this.detail = `X network unavailable · retrying at ${new Date(
            this.inboxRetryAt
          ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
          console.error("[x] inbox navigation failed; waiting before retry:", error);
        }
      }
    }

    if (!isCurrent()) return;
    inboxLoaded = inboxLoaded && Date.now() >= this.inboxRetryAt;

    const url = this.page.url();
    if (inboxLoaded && (url.includes("/login") || url.includes("/i/flow"))) {
      this.state = "disconnected";
      this.detail = "X session expired — sign in again from Connections";
      console.error("[x] session invalid/expired — refresh X_AUTH_TOKEN/X_CT0.");
      return;
    }
    if (inboxLoaded && await isLocked(this.page)) {
      // Headless self-host: unlock ourselves from X_PASSCODE rather than waiting
      // for someone to sit at a screen. Falls through to "locked" if we can't.
      const result = await tryUnlock(this.page, { passcode: this.session ? (this.session.passcode || "") : undefined, accountId: this.accountId });
      if (result !== "unlocked" && result !== "not-locked") {
        this.markLocked(result);
        return;
      }
    }
    this.chatPage = await this.browser.newPage();
    await this.configurePage(this.chatPage);
    if (!isCurrent()) return;
    this.watchForRateLimits(this.chatPage);
    this.chatPage.on("error", (err) => {
      if (!isCurrent()) return;
      console.error("[x] chat page error:", err.message);
      this.scheduleReconnect();
    });
    // Deliberately leave the history page on about:blank. It navigates only
    // for an explicit Recover/Backfill request.
    // Outbound sends get a dedicated page. Background message refreshes can
    // navigate chatPage at any time; sharing it with the composer caused fast
    // consecutive sends to be interrupted and remain pending indefinitely.
    this.sendPage = await this.browser.newPage();
    await this.configurePage(this.sendPage);
    if (!isCurrent()) return;
    this.watchForRateLimits(this.sendPage);
    this.sendPage.on("error", (err) => {
      if (!isCurrent()) return;
      console.error("[x] send page error:", err.message);
      this.scheduleReconnect();
    });
    // Likewise, merely opening a conversation in Omni must not navigate X.
    // The send page is warmed only by a real outbound send.
    // XChat hides message requests behind the All menu. Keep that list mounted
    // on its own passive page so requests update without toggling filters or
    // reloading the main inbox every poll.
    this.requestPage = await this.browser.newPage();
    await this.configurePage(this.requestPage);
    if (!isCurrent()) return;
    this.watchForRateLimits(this.requestPage);
    this.requestPage.on("error", (err) => {
      if (!isCurrent()) return;
      console.error("[x] requests page error:", err.message);
      this.scheduleReconnect();
    });
    if (inboxLoaded && Date.now() >= this.inboxRetryAt) {
      // Stagger the second live XChat route instead of opening two encrypted
      // inboxes in the same request burst.
      await delay(5000);
      if (!isCurrent()) return;
      if (Date.now() >= this.inboxRetryAt) {
        this.lastRequestNavigationAt = Date.now();
        await this.requestPage
          .goto("https://x.com/i/chat/requests", { waitUntil: "domcontentloaded" })
          .then(() => delay(2500))
          .catch((error) =>
            console.error("[x] requests inbox could not be opened:", error)
          );
        if (!(await this.unlockBackgroundPage(this.requestPage, "requests")))
          return;
      }
    }
    if (!isCurrent()) return;
    this.state = "ready";
    this.reconnectFailures = 0;
    if (inboxLoaded && Date.now() >= this.inboxRetryAt) {
      this.detail = undefined; // clear any prior transient failure
    }
    console.log(
      inboxLoaded ? "[x] live (XChat loaded)" : "[x] browser ready; inbox is cooling down"
    );

    const onMessage = this.onMessage!;
    if (inboxLoaded) {
      await this.sync(onMessage, true).catch((e) =>
        console.error("[x] backfill error:", e)
      );
    }
    if (!isCurrent() || this.state !== "ready") return;
    if (Date.now() >= this.inboxRetryAt) await this.page?.bringToFront().catch(() => null);

    // Single poll loop — clear any previous one first so reconnects don't stack.
    if (this.timer) clearInterval(this.timer);
    // Discovery may scroll/load older rows, so keep it paced. A separate
    // read-only loop observes already-rendered replies without navigating,
    // scrolling, unlocking, or waiting behind history work.
    const everyMs = Math.max(60000, Number(process.env.X_POLL_MS || 60000));
    this.timer = setInterval(() => {
      this.sync(onMessage).catch((e) => console.error("[x] poll error:", e));
    }, everyMs);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = setInterval(() => {
      void this.syncLivePreviews().catch((e) => console.error("[x] live inbox read failed:", e));
    }, 5000);
    console.log(`[x] live inbox observation every 5s; discovery every ${everyMs / 1000}s; history remains paced`);
    this.scheduleAutomaticRepair();
  }

  private syncLivePreviews(): Promise<void> {
    if (this.liveRead) return this.liveRead;
    const lifecycle = this.lifecycleVersion;
    const page = this.page;
    const current = () => !this.stopping && this.state === "ready" &&
      lifecycle === this.lifecycleVersion && page === this.page &&
      Date.now() >= this.inboxRetryAt && this.outboundPending === 0;
    if (!current() || !page || page.isClosed() || !this.onMessage) return Promise.resolve();
    const read = (async () => {
      const general = await this.scrapeConversations(page, 0, "general", false);
      if (!current()) return;
      const requests = this.requestPage && !this.requestPage.isClosed() &&
        new URL(this.requestPage.url()).pathname === "/i/chat/requests"
        ? await this.scrapeConversations(this.requestPage, 0, "spam", false) : [];
      const generalIds = new Set(general.map((item) => item.id));
      let updates = 0;
      for (const conversation of [...general, ...requests.filter((item) => !generalIds.has(item.id))]) {
        if (!current()) return;
        if (await this.persistPreview(conversation, this.onMessage!, false, current)) updates++;
      }
      if (updates) console.log(`[x] live inbox saved ${updates} preview update(s) at=${new Date().toISOString()}`);
      await this.syncWarmConversation(current);
    })().finally(() => {
      if (this.liveRead === read) this.liveRead = undefined;
    });
    this.liveRead = read;
    return read;
  }

  private async syncWarmConversation(current: () => boolean): Promise<void> {
    const page = this.sendPage;
    // Observe only the already-open send route. No navigation, clicks, Info
    // menus, downloads or extra X requests; retain the existing idle parking.
    const route = page && !page.isClosed() ? new URL(page.url()).pathname : "";
    const chatExternalId = route.match(/^\/i\/chat\/([^/]+)$/)?.[1];
    if (!chatExternalId || !page || !current() || !this.accountId) return;
    const valid = () => current() && page === this.sendPage && !page.isClosed() && new URL(page.url()).pathname === route;
    const stored = await prisma.conversation.findFirst({
      where: { accountId: this.accountId, platform: "x", externalId: chatExternalId },
      select: { contact: { select: { name: true, handle: true, isGroup: true } } },
    });
    if (!stored || !valid()) return;
    const messages = await this.readMessageWindow(page, { passive: true });
    if (!valid()) return;
    await this.persistMessageWindow(chatExternalId, messages, {
      name: stored.contact.name, handle: stored.contact.handle || stored.contact.name,
      isGroup: stored.contact.isGroup, inboxCategory: "general",
    }, valid);
  }

  private async persistMessageWindow(
    chatExternalId: string,
    messages: ScrapedMessage[],
    source: { name: string; handle: string; isGroup: boolean; inboxCategory: "general" | "spam" },
    current: () => boolean
  ): Promise<{ undated: number; unavailableAttachments: number }> {
    let undated = 0;
    let unavailableAttachments = 0;
    for (const message of orderXMinuteMessages(messages)) {
      if (!current()) throw new Error("X history interrupted; retrying later");
      if (!message.text && !message.attachments?.length) continue;
      // Only a native ID with a verified date, or its already-saved date, can
      // enter history. Never use the read/import clock to invent a sent time.
      const existing = !message.timestamp ? await prisma.message.findUnique({ where: { externalKey: `x:${message.id}` }, select: { createdAt: true } }) : null;
      const timestamp = message.timestamp || existing?.createdAt.getTime();
      if (!timestamp) { undated++; continue; }
      for (const [index, media] of (message.attachments?.length ? message.attachments : [undefined]).entries()) {
        if (!current()) throw new Error("X history interrupted; retrying later");
        if (media && !media.url) unavailableAttachments++;
        await this.onMessage!({
          platform: "x", chatExternalId,
          messageExternalId: index ? `x:${message.id}:attachment:${index}` : `x:${message.id}`,
          direction: message.direction, body: index ? "" : message.text, media,
          inboxCategory: source.inboxCategory, historical: true,
          timestamp: new Date(timestamp), timestampVerified: Boolean(message.timestamp),
          isGroup: source.isGroup,
          contact: { externalKey: `x:${chatExternalId}`, name: source.name, handle: source.handle },
        });
      }
    }
    return { undated, unavailableAttachments };
  }

  private persistPreview(
    conv: ScrapedConversation,
    onMessage: (m: InboundMessage) => Promise<void>,
    initial: boolean,
    current: () => boolean
  ): Promise<boolean> {
    // Discovery and live reads can overlap. Serialize checkpoints so one
    // pushed preview is saved once, and failed writes remain retryable.
    const write = this.previewWrites.then(async () => {
      const key = `${conv.inboxCategory}:${conv.id}`;
      const previewKey = previewSignature(conv);
      if (!current() || this.conversationPreviews.get(key) === previewKey) return false;
      const prior = this.conversationPreviews.get(key);
      if (prior && !previewKey.startsWith("media-v2:") && normalizeXMessageText(prior.replace(/:[^:]*$/, "")) === normalizeXMessageText(previewKey.replace(/:[^:]*$/, ""))) {
        // Re-rendered inbox clocks are not message events, even if a newer
        // outgoing message now sits at the end of the saved conversation.
        // Still verify native history: a genuine identical repeat gets its ID.
        this.conversationPreviews.set(key, previewKey);
        this.enqueueAutomaticRepair(conv);
        return false;
      }
      if (!conv.preview || !conv.timestamp) {
        this.enqueueAutomaticRepair(conv);
        this.conversationPreviews.set(key, previewKey);
        return false;
      }
      const digest = createHash("sha256").update(`${key}:${previewKey}`).digest("hex").slice(0, 24);
      await onMessage({
        platform: "x", chatExternalId: conv.id, messageExternalId: `x:preview:${digest}`,
        direction: conv.direction, body: conv.preview, inboxCategory: conv.inboxCategory,
        historical: initial || Date.now() - conv.timestamp > 5 * 60 * 1000,
        timestamp: new Date(conv.timestamp), timestampVerified: Boolean(conv.timeLabel) && !xInboxDateIsEstimate(conv.timeLabel || ""),
        isGroup: conv.id.startsWith("g"),
        contact: { externalKey: `x:${conv.id}`, name: conv.name || "X user",
          handle: conv.handle || conv.name || conv.id,
          avatarUrl: existingAvatar(`x_${conv.id}`) || undefined },
      });
      if (!current()) return true;
      this.conversationPreviews.set(key, previewKey);
      this.enqueueAutomaticRepair(conv);
      return true;
    });
    this.previewWrites = write.then(() => undefined, () => undefined);
    return write;
  }

  private async configurePage(page: Page): Promise<void> {
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);
    try {
      // Stay internally consistent with the Chrome binary that is actually
      // running. The old persisted synthetic fingerprint advertised a
      // different Chrome version and occasionally left X at ScriptLoadFailure.
      const userAgent = (await page.browser().userAgent()).replace(
        "HeadlessChrome",
        "Chrome"
      );
      await page.setUserAgent(userAgent);
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    } catch (error) {
      console.error("[x] browser setup failed, using fallback UA:", error);
      await page.setUserAgent(REAL_UA);
      await page.setViewport({ width: 1280, height: 900 });
    }
  }

  private async ensureRequestInboxReady(): Promise<void> {
    const page = this.requestPage;
    if (!page || page.isClosed() || Date.now() < this.inboxRetryAt) return;
    const pathname = new URL(page.url()).pathname;
    if (pathname === "/i/chat/requests" || pathname.startsWith("/i/chat/requests/")) {
      return;
    }

    // When the worker starts during a saved cooldown all X pages remain blank.
    // Recover General first, then Requests on the following poll so the two
    // expensive encrypted inbox routes never load in the same burst.
    if (Date.now() - this.lastInboxNavigationAt < 30000) return;
    const retryMs = Math.max(
      5 * 60 * 1000,
      Number(process.env.X_INBOX_RECOVERY_MS || 10 * 60 * 1000)
    );
    if (
      this.lastRequestNavigationAt > 0 &&
      Date.now() - this.lastRequestNavigationAt < retryMs
    ) {
      return;
    }

    this.lastRequestNavigationAt = Date.now();
    await page
      .goto("https://x.com/i/chat/requests", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .then(() => delay(2500))
      .catch((error) =>
        console.error("[x] requests inbox recovery could not be opened:", error)
      );
    await this.unlockBackgroundPage(page, "requests");
  }

  private async parkActionPage(page: Page | undefined): Promise<void> {
    if (!page || page.isClosed() || page.url() === "about:blank") return;
    await page
      .goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5000 })
      .catch(() => null);
  }

  private scheduleSendPagePark(): void {
    if (this.sendPageIdleTimer) clearTimeout(this.sendPageIdleTimer);
    this.sendPageIdleTimer = setTimeout(() => {
      this.sendPageIdleTimer = undefined;
      if (this.outboundPending > 0) return;
      void this.parkActionPage(this.sendPage);
    }, 60000);
  }

  // Park in the locked state with a reason the Connections panel can render.
  // Every detail string keeps the word "locked" — that's what the UI matches on
  // to decide whether to show the XChat unlock card.
  private markLocked(result: UnlockResult): void {
    this.state = "disconnected";
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = undefined;
    if (result === "no-passcode") {
      this.detail = "XChat locked — no passcode set";
      console.error(
        "[x] XChat is locked. Set X_PASSCODE in .env to unlock automatically (works headless), or run `npm run x:unlock` on a machine with a screen."
      );
    } else if (result === "rejected") {
      this.detail = "XChat locked — passcode rejected";
    } else {
      this.detail = "XChat locked";
      console.error("[x] XChat is locked and the unlock attempt errored.");
    }
  }

  private async unlockBackgroundPage(page: Page, label: string): Promise<boolean> {
    if (!(await isLocked(page))) return true;
    const result = await tryUnlock(page, { passcode: this.session ? (this.session.passcode || "") : undefined, accountId: this.accountId });
    if (result === "unlocked" || result === "not-locked") return true;
    console.error(`[x] ${label} page could not be unlocked`);
    this.markLocked(result);
    return false;
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectFailures += 1;
    this.state = "disconnected";
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = undefined;
    const retryMs = Math.min(
      5 * 60 * 1000,
      10000 * 2 ** Math.min(5, this.reconnectFailures - 1)
    );
    this.detail = `X browser reconnecting at ${new Date(
      Date.now() + retryMs
    ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    console.log(`[x] reconnecting in ${Math.ceil(retryMs / 1000)}s…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopping) return;
      this.reconnecting = false;
      this.connect().catch((error) => {
        console.error("[x] reconnect failed:", error);
        this.scheduleReconnect();
      });
    }, retryMs);
  }

  // Reads the conversation list, then each conversation's messages, and feeds
  // them to the store (deduped by a content hash).
  private async sync(
    onMessage: (m: InboundMessage) => Promise<void>,
    initial = false
  ): Promise<void> {
    if (this.stopping || this.state !== "ready" || !this.page || this.busy || this.outboundPending > 0) return;
    if (Date.now() < this.inboxRetryAt) {
      await this.parkForCooldown();
      return;
    }
    await this.cooldownParkPromise;
    const run = ++this.pageRun;
    this.busy = true;
    try {
      const inboxSelector =
        '[data-testid="dm-conversation-scroller"] a[href*="/i/chat/"]';
      const recoveryMs = Math.max(
        5 * 60 * 1000,
        Number(process.env.X_INBOX_RECOVERY_MS || 10 * 60 * 1000)
      );
      let navigated = false;
      if (
        !(await this.page.$(xchatSelector(inboxSelector))) &&
        !initial &&
        Date.now() - this.lastInboxNavigationAt >= recoveryMs
      ) {
        // One deliberate navigation after a long quiet period. Never reload on
        // every DOM scan: that was the source of the request storm.
        navigated = true;
        this.lastInboxNavigationAt = Date.now();
        await this.page.goto("https://x.com/i/chat", {
          waitUntil: "domcontentloaded",
        }).catch((error) =>
          console.error("[x] quiet inbox recovery navigation failed:", error)
        );
        await delay(4000);
      }
      if (this.stopping || run !== this.pageRun || Date.now() < this.inboxRetryAt) return;
      // A fresh browser started during cooldown has never unlocked XChat.
      // The encrypted inbox cannot render its list until this gate is passed.
      // Doing this after waitForSelector turned every recovery into another
      // ten-minute "page load" pause.
      if (!(await this.unlockBackgroundPage(this.page, "inbox"))) return;
      if (this.stopping || run !== this.pageRun || Date.now() < this.inboxRetryAt) return;
      try {
        await this.page.waitForSelector(xchatSelector(inboxSelector), {
          visible: true,
          timeout: initial || navigated ? 15000 : 3000,
        });
      } catch {
        const diagnostic = await this.page.evaluate(() => {
          const root =
            document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
              ?.shadowRoot ?? document;
          return {
            url: location.href,
            body: `${document.body?.innerText || ""}\n${
              (root as ShadowRoot).host ? (root as ShadowRoot).textContent || "" : ""
            }`.slice(0, 600),
            scriptFailure: Boolean(root.querySelector("#ScriptLoadFailure")),
          };
        }).catch(() => ({ url: "", body: "", scriptFailure: false }));
        if (/\/login|\/i\/flow\//.test(diagnostic.url)) {
          this.state = "disconnected";
          this.detail = "X session expired — sign in again from Connections";
          if (this.timer) clearInterval(this.timer);
          this.timer = undefined;
          if (this.liveTimer) clearInterval(this.liveTimer);
          this.liveTimer = undefined;
          return;
        }
        const rateLimited =
          Date.now() - this.lastHttp429At < 60_000 ||
          /rate limit|too many requests|try again later/i.test(diagnostic.body);
        if (rateLimited) {
          if (Date.now() >= this.inboxRetryAt) this.markRateLimited();
          return;
        }
        this.inboxFailures += 1;
        const retryMs = Math.min(
          30 * 60 * 1000,
          recoveryMs * 2 ** Math.min(2, this.inboxFailures - 1)
        );
        this.inboxRetryAt = Date.now() + retryMs;
        const networkFailure =
          diagnostic.url.startsWith("chrome-error://") ||
          /ERR_NAME_NOT_RESOLVED|site can.t be reached|network/i.test(diagnostic.body);
        this.detail = networkFailure
          ? `X network unavailable · retrying at ${new Date(
              this.inboxRetryAt
            ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : `X inbox paused after a load error · retrying at ${new Date(
              this.inboxRetryAt
            ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
        console.error(
          `[x] inbox unavailable (${networkFailure ? "network" : diagnostic.scriptFailure ? "script load" : "page load"}); waiting ${Math.ceil(retryMs / 60000)}m`
        );
        return;
      }
      if (this.stopping || run !== this.pageRun || Date.now() < this.inboxRetryAt) return;
      this.inboxFailures = 0;
      // One successful DOM read only proves the page loaded. Keep recent
      // strikes long enough for a second 429 to receive a longer cooldown;
      // otherwise X was retried every 15 minutes indefinitely.
      if (Date.now() - this.lastRateLimitAt >= 6 * 60 * 60 * 1000) {
        this.rateLimitFailures = 0;
        this.lastRateLimitAt = 0;
      }
      this.inboxRetryAt = 0;
      this.rateLimitUntil = 0;
      this.detail = undefined;
      this.persistRateLimitCooldown();
      await delay(400);
      if (run !== this.pageRun) return;
      await this.ensureRequestInboxReady();
      if (this.state !== "ready" || run !== this.pageRun || Date.now() < this.inboxRetryAt) return;
      const generalConversations = await this.scrapeConversations(
        this.page,
        initial ? 6 : 2,
        "general",
        true
      );
      const generalIds = new Set(generalConversations.map((item) => item.id));
      const requestConversations = (
        await this.scrapeConversations(
          this.requestPage,
          initial ? 4 : 2,
          "spam",
          true
        )
      ).filter((item) => !generalIds.has(item.id));
      if (run !== this.pageRun) return;
      this.avatarSources.remember([...generalConversations, ...requestConversations]);
      const changedGeneral = generalConversations.filter(
        (conversation) =>
          this.conversationPreviews.get(`general:${conversation.id}`) !==
          previewSignature(conversation)
      );
      const changedRequests = requestConversations.filter(
        (conversation) =>
          this.conversationPreviews.get(`spam:${conversation.id}`) !==
          previewSignature(conversation)
      );
      // The list preview is already pushed live by XChat. Persist that preview
      // directly instead of opening every changed conversation: repeated route
      // loads trigger X's rate limiter and can pause the whole inbox. Explicit
      // user backfills still use the detail reader and native message UUIDs.
      const targets = [...changedGeneral, ...changedRequests];
      console.log(
        `[x] inbox ${generalConversations.length} + ${requestConversations.length} requests; ${targets.length} preview update${targets.length === 1 ? "" : "s"}${initial ? " (startup)" : ""}`
      );

      for (const conv of targets) {
        if (run !== this.pageRun || this.outboundPending > 0) return;
        await this.persistPreview(conv, onMessage, initial, () =>
          !this.stopping && run === this.pageRun && this.outboundPending === 0 && Date.now() >= this.inboxRetryAt);
        // Avatars are optional background work, never a dependency of the
        // fast reply path. Subsequent updates reuse the saved local file.
        if (conv.avatar && !existingAvatar(`x_${conv.id}`)) {
          const avatarUrl = await saveAvatarFromUrl(`x_${conv.id}`, conv.avatar);
          if (avatarUrl && this.accountId) await prisma.contact.updateMany({
            where: { conversations: { some: { accountId: this.accountId, externalId: conv.id, platform: "x" } } },
            data: { avatarUrl },
          });
        }
      }
      if (this.accountId) {
        for (const conv of [...generalConversations, ...requestConversations]) {
          if (conv.timestamp) await reconcileXConversationTime(this.accountId, conv.id, conv.timestamp);
          this.enqueueAutomaticRepair(conv);
        }
        await this.enqueueDailyHistoryAudit();
      }
      this.persistRepairState();
      // Only a completed inbox pass advances this timestamp, not a heartbeat
      // or opening a single conversation. Requests must have loaded too.
      if (this.requestPage && await this.requestPage.$(xchatSelector('[data-testid="dm-message-requests-scroller"],a[href^="/i/chat/requests/"]'))) this.lastInboxCheckedAt = Date.now();
    } catch (e) {
      const s = String(e);
      if (/detached|Target closed|Session closed|Connection closed|Protocol error/i.test(s)) {
        console.error("[x] page lost during sync:", s);
        this.scheduleReconnect();
      } else {
        throw e;
      }
    } finally {
      if (run === this.pageRun) this.busy = false;
      if (run === this.pageRun) await this.parkActionPage(this.chatPage);
    }
  }

  private automaticRepairPaceMs(): number {
    return Math.max(
      60000,
      Number(process.env.X_AUTO_REPAIR_PACE_MS || 60000)
    );
  }

  private async enqueueDailyHistoryAudit(): Promise<void> {
    if (!this.accountId || Date.now() - this.lastHistoryAuditAt < 24 * 60 * 60_000) return;
    // Include active saved chats outside the currently rendered inbox window.
    // Idle chats retain their existing history; changes discovered by the inbox
    // scanner still enqueue them normally, regardless of their age.
    const chats = await prisma.conversation.findMany({
      where: { accountId: this.accountId, platform: "x", externalId: { not: null }, lastMessageAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
      select: { externalId: true, inboxCategory: true, lastMessageAt: true, contact: { select: { name: true, handle: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true } } },
    });
    for (const chat of chats) {
      this.enqueueAutomaticRepair({ id: chat.externalId!, name: chat.contact.name, handle: chat.contact.handle || chat.contact.name, unread: false, inboxCategory: chat.inboxCategory === "spam" ? "spam" : "general", preview: chat.messages[0]?.body || "", direction: chat.messages[0]?.direction === "out" ? "out" : "in", timestamp: chat.lastMessageAt.getTime() }, true);
    }
    this.lastHistoryAuditAt = Date.now();
    this.persistRepairState();
    console.log(`[x] daily history audit scheduled for ${chats.length} active chats; ${this.automaticRepairQueue.size} queued at the normal safe pace`);
  }

  private enqueueAutomaticRepair(conversation: ScrapedConversation, dailyAudit = false): void {
    const key = `${conversation.inboxCategory}:${conversation.id}`;
    const previewKey = previewSignature(conversation);
    if (this.repairedPreviews.get(key) === previewKey && !dailyAudit && Date.now() - (this.lastRepairAt.get(key) || 0) < 24 * 60 * 60_000) return;
    const existing = this.automaticRepairQueue.get(key);
    if ((this.repairRetryAt.get(key) || 0) > Date.now()) {
      // A new message must not inherit the failure cooldown of an older
      // missing attachment. The shared account/network pace still applies.
      if (!existing || existing.previewKey === previewKey || dailyAudit) return;
      this.repairRetryAt.delete(key);
    }
    if (dailyAudit && existing) return;
    if (existing?.previewKey === previewKey) return;
    this.automaticRepairQueue.set(key, {
      id: conversation.id,
      name: conversation.name || "X user",
      inboxCategory: conversation.inboxCategory,
      previewKey,
      attempts: existing?.attempts || 0,
      live: !dailyAudit && Boolean(conversation.timestamp && Date.now() - conversation.timestamp < 5 * 60 * 1000),
      activityAt: conversation.timestamp || 0,
    });
    this.persistRepairState();
    if (!existing) {
      console.log(
        `[x] queued full message repair for ${conversation.name || conversation.id}`
      );
    }
    this.scheduleAutomaticRepair();
  }

  private scheduleAutomaticRepair(delayMs?: number): void {
    if (
      this.stopping ||
      this.automaticRepairRunning ||
      this.automaticRepairTimer ||
      this.automaticRepairQueue.size === 0
    ) {
      return;
    }
    const waitMs = Math.max(
      1000,
      delayMs ?? this.automaticRepairNextAt - Date.now()
    );
    this.automaticRepairTimer = setTimeout(() => {
      this.automaticRepairTimer = undefined;
      void this.processAutomaticRepair();
    }, waitMs);
  }

  private async processAutomaticRepair(): Promise<void> {
    if (this.stopping || this.automaticRepairRunning || this.automaticRepairQueue.size === 0) return;
    if (Date.now() < this.inboxRetryAt) {
      this.scheduleAutomaticRepair(this.inboxRetryAt - Date.now() + 1000);
      return;
    }
    if (this.state !== "ready" || this.busy || this.outboundPending > 0) {
      this.scheduleAutomaticRepair(this.state === "ready" ? 5000 : 30000);
      return;
    }

    // New replies must not sit behind hours of daily audit work. Keep the
    // same network pace, but service fresh activity before old backfills.
    const next = [...this.automaticRepairQueue.entries()].filter(([key]) => (this.repairRetryAt.get(key) || 0) <= Date.now()).sort((a, b) =>
      Number(Boolean(b[1].live)) - Number(Boolean(a[1].live)) ||
      (a[1].live && b[1].live ? (b[1].activityAt || 0) - (a[1].activityAt || 0) : 0)
    )[0];
    if (!next) {
      const retryAt = Math.min(...[...this.automaticRepairQueue.keys()].map(key => this.repairRetryAt.get(key) || Date.now() + 60000));
      this.scheduleAutomaticRepair(Math.max(1000, retryAt - Date.now()));
      return;
    }
    const [key, repair] = next;
    this.automaticRepairRunning = true;
    try {
      await this.requestHistory(repair.id, "", 0, 100, {
        inboxCategory: repair.inboxCategory,
        sinceTimestamp: Math.min(this.lastRepairAt.get(key) || Date.now() - 72 * 60 * 60 * 1000, Date.now() - 24 * 60 * 60 * 1000),
      });
      // A live read may enqueue a newer reply while this history request is
      // running. Complete only the snapshot we actually processed.
      if (this.automaticRepairQueue.get(key) === repair) this.automaticRepairQueue.delete(key);
      this.repairedPreviews.set(key, repair.previewKey);
      this.lastRepairAt.set(key, Date.now());
      this.repairRetryAt.delete(key);
      this.persistRepairState();
      console.log(
        `[x] fully repaired ${repair.name}; ${this.automaticRepairQueue.size} queued`
      );
    } catch (error) {
      const message = String(error);
      const deferred =
        /already syncing|reconnecting|cooling down|being paced|not ready|paused for a send|history interrupted/i.test(
          message
        );
      if (!deferred) repair.attempts += 1;
      // A broken chat must not monopolize the queue or trigger an unlimited
      // stream of history loads. Only attempts that actually ran count here.
      const superseded = this.automaticRepairQueue.get(key) !== repair;
      if (!superseded) this.automaticRepairQueue.delete(key);
      if (!superseded && repair.attempts >= 3) {
        this.repairRetryAt.set(key, Date.now() + 6 * 60 * 60 * 1000);
        // Keep the actual work durable. Previously it disappeared from the
        // queue after three failures and depended on rediscovery to return.
        repair.attempts = 0;
        this.automaticRepairQueue.set(key, repair);
        console.error(
          `[x] automatic repair paused for ${repair.name} for 6 hours after 3 attempts:`,
          error
        );
      } else if (!superseded) {
        // Move failed work behind the other chats instead of retrying the
        // same first entry forever.
        this.automaticRepairQueue.set(key, repair);
        console.warn(`[x] automatic repair deferred for ${repair.name}:`, error);
      }
    } finally {
      this.automaticRepairRunning = false;
      this.persistRepairState();
      this.automaticRepairNextAt = Date.now() + this.automaticRepairPaceMs();
      this.scheduleAutomaticRepair();
    }
  }

  private async scrapeConversations(
    page: Page | undefined,
    scrollRounds = 0,
    inboxCategory: "general" | "spam" = "general",
    discover = false
  ): Promise<ScrapedConversation[]> {
    if (!page || page.isClosed()) return [];
    if (discover) {
      await page.evaluate(scrollXSurface, { kind: "inbox", direction: "start", category: inboxCategory } as const);
      await delay(200);
    }
    const found = new Map<string, ScrapedConversation>();
    for (let round = 0; round <= scrollRounds; round++) {
      this.assertNotCoolingDown();
      if (this.stopping || this.outboundPending > 0) break;
      const visible = await page.evaluate((category) => {
        const root =
          document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
            ?.shadowRoot ?? document;
        const selector =
          category === "spam"
            ? 'a[href^="/i/chat/requests/"]'
            : 'a[href^="/i/chat/"]:not([href="/i/chat/requests"]):not([href^="/i/chat/requests/"])';
        return (Array.from(
          root.querySelectorAll(selector)
        ) as HTMLAnchorElement[]).map((anchor) => {
          const href = anchor.getAttribute("href") || "";
          const id = href.match(/^\/i\/chat\/(?:requests\/)?([^/?#]+)/)?.[1] || "";
          const lines = (anchor.innerText || "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const time = anchor.querySelector('time');
          const timeLabel = time?.getAttribute('datetime') || time?.getAttribute('title') || time?.textContent ||
            lines.slice(1).find((line) => /^(?:now|today|yesterday|\d+\s*(?:s|m|h|d|w)|\d{1,2}:\d{2}\s*(?:AM|PM)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?)$/i.test(line)) || "";
          const stablePreview = lines.slice(1).filter((line) => {
            // Relative timestamps and unread badges change without a new DM.
            // Treating them as message text caused a chat navigation every
            // minute, even when the conversation had not changed.
            return !(
              /^\d+$/.test(line) ||
              /^\d+\s*(s|m|h|d|w)$/i.test(line) ||
              /^\d+\s*(sec(ond)?|min(ute)?|hour|day|week)s?$/i.test(line) ||
              /^(now|today|yesterday)$/i.test(line) ||
              /^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(line) ||
              /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}$/i.test(line) ||
              line === timeLabel ||
              /^(typing|recording audio)(?:\s*[.…]+)?$/i.test(line)
            );
          });
          const image = anchor.querySelector("img") as HTMLImageElement | null;
          const previewLines = stablePreview.filter((line) => {
            if (category !== "spam") return true;
            // Message-request rows append profile context after the actual DM.
            // Keep that context out of the message bubble stored in Omni.
            return !(
              /^Followed by\b/i.test(line) ||
              /^\d+(?:\.\d+)?[KMB]?\s+Followers?$/i.test(line) ||
              /^\d+(?:\.\d+)?[KMB]?\s+Following$/i.test(line)
            );
          });
          const rawPreview = previewLines.join("\n");
          // `You:` is a real outgoing text sent from X itself and must be
          // mirrored into Omni. First-person action summaries are not message
          // bodies, so leave those empty rather than creating fake DMs.
          const outgoingText = /^You:\s*/i.test(rawPreview);
          const ownSystemPreview = /^You\s+(?:reacted|sent|shared)\b/i.test(
            rawPreview
          );
          const direction: "in" | "out" = outgoingText ? "out" : "in";
          return {
            id,
            name: lines[0] || id,
            handle: "",
            preview: ownSystemPreview
              ? ""
              : rawPreview.replace(/^You:\s*/i, "").trim(),
            direction,
            unread: Boolean(
              anchor.querySelector('[data-icon="icon-circle-fill"]')
            ),
            inboxCategory: category,
            avatar: image?.src,
            timeLabel,
          };
        });
      }, inboxCategory);
      for (const conversation of visible) {
        if (conversation.id && !found.has(conversation.id)) {
          let timestamp = parseXDate(conversation.timeLabel, Date.now(), "Today");
          const key = `${inboxCategory}:${conversation.id}`;
          const signature = `${conversation.direction}:${conversation.preview}`;
          const previous = this.inboxDates.get(key);
          // Relative labels are rounded by X. Re-reading "7h" a minute later
          // is not new activity and must not keep moving a chat up the inbox.
          if (previous?.preview === signature) {
            timestamp = stableXInboxDate(conversation.timeLabel || "", timestamp, previous.timestamp);
          }
          if (timestamp) this.inboxDates.set(key, { preview: signature, timestamp });
          found.set(conversation.id, { ...conversation, timestamp });
        }
      }
      if (round === scrollRounds) break;
      const nextOffset = await page.evaluate(scrollXSurface, { kind: "inbox", direction: "older", category: inboxCategory, resume: discover && round === 0 ? this.discoveryOffsets[inboxCategory] : null } as const);
      if (discover && nextOffset) this.discoveryOffsets[inboxCategory] = nextOffset.end ? 0 : nextOffset.offset;
      await delay(500);
    }
    if (scrollRounds > 0) {
      await page.evaluate(scrollXSurface, { kind: "inbox", direction: "start", category: inboxCategory } as const);
      await delay(200);
    }
    return [...found.values()];
  }

  private async scrapeMessages(
    conversationId: string,
    loadHistory: boolean | number = false,
    isRequest = false,
    timeoutMs?: number,
    range?: { sinceTimestamp?: number; beforeTimestamp?: number; count: number; targetId?: string; latest?: XLatestPreview },
    onWindow?: (messages: ScrapedMessage[]) => Promise<void>
  ): Promise<{ messages: ScrapedMessage[]; covered: boolean }> {
    const page = isRequest ? this.requestPage : this.chatPage;
    if (!page) throw new Error("X history page is unavailable");
    // X's virtual message list hydrates on animation frames. A background tab
    // can keep returning the cached viewport even after its scrollTop changes.
    // Activate only our headless connector page, not the user's browser window.
    await page.bringToFront();
    if (isRequest) {
      await this.openRequestConversation(page, conversationId);
    } else {
      await this.openGeneralConversation(page, conversationId, false);
    }
    await page.waitForSelector(
      xchatSelector([
        '[data-testid="dm-message-list"]',
        '[data-testid="dm-message-list-container"]',
        '[data-testid="dm-composer-textarea"]',
      ].join(",")),
      {
        visible: true,
        // XChat often paints the route shell several seconds before the
        // encrypted message list. Waiting avoids re-navigating the same chat
        // and creating extra network load when the list was merely late.
        timeout:
          timeoutMs ??
          Math.max(10000, Number(process.env.X_CHAT_LOAD_TIMEOUT_MS || 25000)),
      }
    );
    await delay(300);
    {
      // Large/group conversations can reopen at an old virtualized anchor even
      // though the inbox preview is current. X exposes a native jump control;
      // use it before scraping so live sync reads the newest bubbles rather
      // than silently re-reading an old viewport.
      const bottomSelector = '[data-testid="dm-scroll-to-bottom-button"]';
      const bottomDeadline =
        Date.now() + (conversationId.startsWith("g") ? 2500 : 600);
      let jumpedToLatest = false;
      while (Date.now() < bottomDeadline) {
        if (await page.$(xchatSelector(bottomSelector))) {
          await page.click(xchatSelector(bottomSelector)).catch(() => null);
          jumpedToLatest = true;
          await delay(350);
        } else {
          await delay(150);
        }
      }
      if (jumpedToLatest) await delay(300);
      await page.evaluate(scrollXSurface, { kind: "messages", direction: "newer" } as const);
      await delay(300);
    }
    // The list container appears before the encrypted message contents. Give
    // the first bubble a short independent hydration window so a newly opened
    // conversation cannot be recorded as successfully read while still empty.
    await page
      .waitForSelector(xchatSelector('[data-testid^="message-"]'), {
        visible: true,
        timeout: 4000,
      })
      .catch(() => null);
    // Live refreshes read only what X already rendered. Repeated history
    // scrolling is reserved for the user's explicit Backfill action.
    const scrollRounds =
      typeof loadHistory === "number"
        ? Math.max(0, loadHistory)
        : loadHistory
          ? Number(process.env.X_HISTORY_SCROLLS || 8)
          : 0;
    // Virtualized XChat removes bubbles as they scroll out of view. Capture
    // every window, including the newest one BEFORE scrolling backwards.
    const windows: ScrapedMessage[][] = [await this.readMessageWindow(page, { onWindow })];
    // A cold encrypted route can initially expose only a cached, older window.
    // Wait for the observed newest message without reloading or increasing the
    // network polling rate; a partial pass must never be called fully repaired.
    const latestDeadline = Date.now() + 12_000;
    while (range?.latest && !xHistoryMatchesPreview(mergeXHistory(windows), range.latest) && Date.now() < latestDeadline) {
      this.assertNotCoolingDown();
      if (this.stopping || this.outboundPending > 0) throw new Error("X history paused for a send; retrying later");
      const jump = xchatSelector('[data-testid="dm-scroll-to-bottom-button"]');
      if (await page.$(jump)) await page.click(jump).catch(() => null);
      await page.evaluate(scrollXSurface, { kind: "messages", direction: "newer" } as const);
      await delay(1000);
      windows.push(await this.readMessageWindow(page, { onWindow }));
    }
    let unchanged = 0;
    let reachedStart = false;
    const historyDeadline = Date.now() + 55_000;
    for (let k = 0; k < scrollRounds; k++) {
      this.assertNotCoolingDown();
      if (Date.now() >= historyDeadline) break;
      if (this.stopping || this.outboundPending > 0) throw new Error("X history paused for a send; retrying later");
      const collected = mergeXHistory(windows);
      if (range?.targetId && collected.some((message) => message.id === range.targetId)) break;
      if (range?.sinceTimestamp && collected.some((message) => message.timestamp && message.timestamp <= range.sinceTimestamp!)) break;
      if (range && !range.targetId && !range.sinceTimestamp && collected.filter((message) => message.timestamp && (!range.beforeTimestamp || message.timestamp < range.beforeTimestamp)).length >= range.count) break;
      const position = await page.evaluate(scrollXSurface, { kind: "messages", direction: "older" } as const);
      await delay(1200);
      const window = await this.readMessageWindow(page, { onWindow });
      const before = new Set(windows.flat().map((message) => message.id));
      unchanged = window.some((message) => !before.has(message.id)) ? 0 : unchanged + 1;
      windows.push(window);
      if (unchanged >= 3 && position?.end) { reachedStart = true; break; }
    }
    const messages = mergeXHistory(windows);
    if (range?.latest && !xHistoryMatchesPreview(messages, range.latest)) {
      const surface = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')?.shadowRoot ?? document;
        const scroller = root.querySelector<HTMLElement>('[data-testid="dm-message-scroller"]');
        return { visibility: document.visibilityState, scrollTop: scroller?.scrollTop, scrollHeight: scroller?.scrollHeight, clientHeight: scroller?.clientHeight };
      });
      console.warn("[x] latest message not loaded", JSON.stringify({ conversationId, windows: windows.length, messages: messages.length, expectedAt: range.latest.timestamp, newestAt: Math.max(...messages.map(message => message.timestamp || 0)), ...surface }));
    }
    if (isRequest) await this.restoreRequestList(page);
    if (!messages.length) throw new Error("X message history did not load; no repair checkpoint was saved");
    const covered = xHistoryMatchesPreview(messages, range?.latest) && (range?.targetId ? messages.some((message) => message.id === range.targetId) : reachedStart || !range || (range.sinceTimestamp
      ? messages.some((message) => message.timestamp && message.timestamp <= range.sinceTimestamp!)
      : messages.filter((message) => message.timestamp && (!range.beforeTimestamp || message.timestamp < range.beforeTimestamp)).length >= range.count));
    return { messages, covered };
  }

  private async readMessageWindow(page: Page, options: { passive?: boolean; onWindow?: (messages: ScrapedMessage[]) => Promise<void> } = {}): Promise<ScrapedMessage[]> {
    const rows = await page.evaluate(readXMessageDom);
    const now = Date.now();
    const messages: ScrapedMessage[] = [];
    let infoReads = 0;
    // Resolve newest timestamps first: an old bubble must not consume the
    // bounded Info budget before the reply the user is actually waiting for.
    for (const { dateHints, timeText, day, attachments, ...message } of [...rows].reverse()) {
      const explicitTimestamp = dateHints.map((hint) => parseXDate(hint, now)).find((value) => value !== null);
      let timestamp = explicitTimestamp ?? parseXDate(timeText, now, day) ?? (!timeText ? parseXDate(day, now) : null) ?? xSnowflakeDate(message.id, now);
      // A day label alone is not a photo's sent time. X suppresses timestamps
      // inside sender groups, so recover the exact row's native Info instead.
      if (!explicitTimestamp && !timeText && !xSnowflakeDate(message.id, now)) timestamp = null;
      if (!timestamp) {
        timestamp = this.nativeMessageTimes.get(message.id) || null;
        if (!timestamp) {
          const saved = await prisma.message.findUnique({ where: { externalKey: `x:${message.id}` }, select: { createdAt: true } });
          timestamp = saved?.createdAt.getTime() || null;
        }
        if (!options.passive && !timestamp && infoReads < 12 && (this.nativeTimeRetryAt.get(message.id) || 0) <= now) {
          // Don't make already-dated newest replies wait behind an older
          // row's missing Info control. Keep the native oldest-first order.
          if (infoReads === 0 && messages.length) await options.onWindow?.([...messages].reverse());
          this.assertNotCoolingDown();
          if (this.stopping || this.outboundPending > 0) throw new Error("X history paused for a send; retrying later");
          infoReads++;
          try {
            const sent = await readNativeXMessageTime(page, message.id);
            timestamp = sent ? parseXMessageInfoDate(sent, Date.now()) : null;
            if (timestamp) this.nativeMessageTimes.set(message.id, timestamp);
          } catch (error) {
            // Keep the native ID pending, but retain an actionable reason when
            // X changes the Info controls rather than silently losing media.
            console.warn("[x] native message time deferred:", message.id, error instanceof Error ? error.message : "Unavailable");
          }
          if (!timestamp) this.nativeTimeRetryAt.set(message.id, now + 5 * 60_000);
          if (this.nativeMessageTimes.size > 3000) this.nativeMessageTimes.delete(this.nativeMessageTimes.keys().next().value!);
          if (this.nativeTimeRetryAt.size > 3000) this.nativeTimeRetryAt.delete(this.nativeTimeRetryAt.keys().next().value!);
        }
      }
      messages.push({
        ...message,
        attachments: attachments.map(attachment => ({ type: attachment.type, url: null, name: attachment.name, isGif: attachment.isGif })),
        minutePrecision: !explicitTimestamp && !xSnowflakeDate(message.id, now) && Boolean(timestamp && timestamp % 60_000 === 0),
        timestamp,
      });
    }
    messages.reverse();
    // Publish full text before any slow attachment download or older-history
    // scroll. A later error must not discard the good newest window.
    await options.onWindow?.(messages);
    if (!options.passive) {
      for (const message of messages) {
        const row = rows.find(row => row.id === message.id)!;
        for (const [index, attachment] of row.attachments.entries()) {
          if (this.stopping || this.outboundPending > 0) throw new Error("X history paused for a send; retrying later");
          message.attachments![index] = await this.downloadAttachment(page, message.id, index, attachment);
        }
      }
      if (rows.some(row => row.attachments.length)) await options.onWindow?.(messages);
    }
    if (!options.passive && messages.some((message) => !message.timestamp)) {
      console.warn("[x] history date coverage", JSON.stringify({ total: messages.length, dated: messages.filter((message) => message.timestamp).length }));
    }
    return messages;
  }

  private async downloadAttachment(
    page: Page,
    messageId: string,
    index: number,
    attachment: ReturnType<typeof readXMessageDom>[number]["attachments"][number]
  ): Promise<NonNullable<InboundMessage["media"]>> {
    const externalKey = index ? `x:${messageId}:attachment:${index}` : `x:${messageId}`;
    const cached = this.attachmentCache.get(externalKey);
    if (cached?.url && fs.existsSync(path.join(process.cwd(), "public", cached.url))) return { ...cached, isGif: cached.isGif || attachment.isGif };
    const saved = await prisma.message.findUnique({ where: { externalKey }, select: { mediaUrl: true, mediaName: true, mediaType: true, mediaIsGif: true } });
    if (saved?.mediaUrl?.startsWith("/media/") && fs.existsSync(path.join(process.cwd(), "public", saved.mediaUrl))) {
      const result = { type: (saved.mediaType || attachment.type) as NonNullable<InboundMessage["media"]>["type"], url: saved.mediaUrl, name: saved.mediaName || attachment.name, isGif: saved.mediaIsGif || attachment.isGif };
      this.attachmentCache.set(externalKey, result);
      return result;
    }
    const unavailable = { type: attachment.type, url: null, name: attachment.name, isGif: attachment.isGif };
    if ((!attachment.source && !attachment.nativeDownload) || (this.attachmentRetryAt.get(externalKey) || 0) > Date.now()) return unavailable;
    try {
      const native = attachment.nativeDownload && attachment.type === "audio" && index === 0
        ? await downloadNativeXVoice(page, messageId, MAX_BYTES) : null;
      const file = native ? { mime: native.mime, base64: native.bytes.toString('base64') }
        : await page.evaluate(readXAttachmentBytes, { url: attachment.source!, maxBytes: MAX_BYTES });
      if (attachment.type !== "file" && !file.mime.startsWith(`${attachment.type}/`)) throw new Error("X returned an unexpected attachment format");
      const namedExt = path.extname(attachment.name || "").slice(1).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "bin";
      const mimeExt = file.mime === "application/octet-stream" ? namedExt : extFromMime(file.mime, namedExt);
      const ext = mimeExt.length <= 12 ? mimeExt : namedExt;
      const url = saveMedia(`x_${messageId}_${index}`, ext, Buffer.from(file.base64, "base64"));
      const result = { type: attachment.type, url, name: native ? `Voice message.${ext}` : attachment.name || `Attachment.${ext}`, isGif: attachment.isGif || file.mime === "image/gif" };
      this.attachmentRetryAt.delete(externalKey);
      this.attachmentCache.set(externalKey, result);
      if (this.attachmentCache.size > 1000) this.attachmentCache.delete(this.attachmentCache.keys().next().value!);
      return result;
    } catch (error) {
      this.attachmentRetryAt.set(externalKey, Date.now() + 5 * 60_000);
      console.warn("[x] attachment download deferred:", error instanceof Error ? error.message : "Unavailable");
      return unavailable;
    }
  }

  private async openRequestConversation(
    page: Page,
    conversationId: string,
    linkTimeoutMs = 20000
  ): Promise<void> {
    this.assertNotCoolingDown();
    const listUrl = "https://x.com/i/chat/requests";
    const targetPath = `/i/chat/requests/${conversationId}`;
    const messageSelector =
      '[data-testid="dm-message-list"],[data-testid="dm-message-list-container"]';
    if (
      new URL(page.url()).pathname === targetPath &&
      (await page.$(xchatSelector(messageSelector)))
    ) return;

    // X's request-detail route needs router state from clicking the list. A
    // direct goto leaves the request list shell at the detail URL.
    if (/\/i\/chat\/requests\/.+/.test(new URL(page.url()).pathname)) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(
        () => null
      );
    }
    if (page.url() !== listUrl) {
      this.assertNotCoolingDown();
      await page.goto(listUrl, { waitUntil: "domcontentloaded" });
    }
    const linkSelector = `a[href="${targetPath}"]`;
    await page.evaluate(scrollXSurface, { kind: "inbox", direction: "start", category: "spam" } as const);
    const linkDeadline = Date.now() + Math.max(500, linkTimeoutMs);
    let linkReady = false;
    while (Date.now() < linkDeadline) {
      this.assertNotCoolingDown();
      linkReady = await page
        .$eval(xchatSelector(linkSelector), (link) => {
          const rect = link.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .catch(() => false);
      if (linkReady) break;
      // Older requests are virtualized too. Waiting on the first viewport
      // forever cannot expose a link below it; advance the native list.
      await page.evaluate(scrollXSurface, { kind: "inbox", direction: "older", category: "spam" } as const);
      await delay(650);
    }
    if (!linkReady) throw new Error("X request conversation was not found");
    this.assertNotCoolingDown();
    const clicked = await page.evaluate((path) => {
      const root =
        document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
          ?.shadowRoot ?? document;
      const link = root.querySelector(`a[href="${path}"]`) as
        | HTMLAnchorElement
        | null;
      if (!link) return false;
      link.click();
      return true;
    }, targetPath);
    if (!clicked) throw new Error("X request conversation link disappeared");
    const detailDeadline = Date.now() + 20000;
    let detailReady = false;
    while (Date.now() < detailDeadline) {
      this.assertNotCoolingDown();
      detailReady = await page
        .evaluate(
          (path, selector) => {
            const root =
              document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
                ?.shadowRoot ?? document;
            return location.pathname === path && Boolean(root.querySelector(selector));
          },
          targetPath,
          messageSelector
        )
        .catch(() => false);
      if (detailReady) break;
      await delay(150);
    }
    if (!detailReady) throw new Error("X request conversation did not finish loading");
  }

  private async openGeneralConversation(
    page: Page,
    conversationId: string,
    requireComposer = true
  ): Promise<void> {
    this.assertNotCoolingDown();
    const targetPath = `/i/chat/${conversationId}`;
    const targetUrl = `https://x.com${targetPath}`;
    const messageSelector =
      '[data-testid="dm-message-list"],[data-testid="dm-message-list-container"]';
    const composerSelector =
      '[data-testid="dm-composer-textarea"],textarea[aria-label="Message"],[data-testid="dm-conversation-panel"] [contenteditable="true"],[data-testid="dm-conversation-panel"] [role="textbox"],[data-testid="dmComposerTextInput"]';
    const waitUntilReady = async (timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        this.assertNotCoolingDown();
        const ready = await page
          .evaluate(
            (path, messages, composer, needsComposer) => {
              if (location.pathname !== path) return false;
              const root =
                document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
                  ?.shadowRoot ?? document;
              const list = root.querySelector(messages);
              const input = root.querySelector(composer) as HTMLElement | null;
              if (!list) return false;
              if (!needsComposer) return true;
              if (!input) return false;
              const rect = input.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            },
            targetPath,
            messageSelector,
            composerSelector,
            requireComposer
          )
          .catch(() => false);
        if (ready) return true;
        await delay(150);
      }
      return false;
    };

    // A mounted message list is not enough: encrypted X chats can render the
    // history several seconds before their composer. Reuse the page only when
    // the complete send surface is ready.
    if (
      new URL(page.url()).pathname === targetPath &&
      (await waitUntilReady(5000))
    )
      return;

    // XChat is a single-page app. Browser Back waits for a document-load event
    // that never arrives and added a fixed ten-second penalty to every chat
    // switch. Click the already-mounted sidebar link when possible, otherwise
    // navigate straight to the target conversation.
    // X currently ignores sidebar clicks for large group routes while a
    // one-to-one conversation is open. Going direct avoids a 15-second stale
    // wait that allowed active sends to cancel the inbound poll before the
    // group could be read.
    const clicked = conversationId.startsWith("g")
      ? false
      : await page.evaluate((path) => {
          const root =
            document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
              ?.shadowRoot ?? document;
          const anchor = root.querySelector(`a[href="${path}"]`) as
            | HTMLAnchorElement
            | null;
          if (!anchor) return false;
          anchor.click();
          return true;
        }, targetPath);
    if (clicked && (await waitUntilReady(15000))) return;

    // A direct navigation is the first recovery path when X's sidebar router
    // stalls or exposes message history before the encrypted composer.
    await page
      .goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .catch(() => null);
    if (await waitUntilReady(30000)) return;

    // One clean reload recovers the occasional half-hydrated XChat document.
    // This is still pre-send, so retrying the navigation cannot duplicate a
    // message.
    await page
      .reload({ waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => null);
    if (await waitUntilReady(30000)) return;

    throw new Error(requireComposer ? "XChat did not finish loading its composer" : "XChat did not finish loading its message history");
  }

  async markRead(
    _chatExternalId: string,
    _context?: OutboundSendContext
  ): Promise<void> {
    // Omni owns its local read state. Opening a CRM chat used to warm X's
    // composer by navigating the send page for every selection, which was the
    // largest source of avoidable XChat traffic when working through a backlog.
    // A real send still opens the composer on demand in performSend().
  }

  private async restoreRequestList(page: Page): Promise<void> {
    if (this.stopping || Date.now() < this.inboxRetryAt) {
      await this.parkActionPage(page);
      return;
    }
    const listUrl = "https://x.com/i/chat/requests";
    if (/\/i\/chat\/requests\/.+/.test(new URL(page.url()).pathname)) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(
        () => null
      );
    }
    // Back itself can receive a 429. Do not follow it with a fresh route load.
    if (this.stopping || Date.now() < this.inboxRetryAt) {
      await this.parkActionPage(page);
      return;
    }
    if (page.url() !== listUrl) {
      await page.goto(listUrl, { waitUntil: "domcontentloaded" });
    }
    await page
      .waitForSelector(xchatSelector('a[href^="/i/chat/requests/"]'), {
        timeout: 10000,
      })
      .catch(() => null);
  }

  async requestHistory(
    chatExternalId: string,
    _oldestMessageId: string,
    _oldestTimestamp: number,
    _count = 100,
    context?: {
      inboxCategory?: "general" | "spam";
      sinceTimestamp?: number;
      targetMessageId?: string;
    }
  ): Promise<void> {
    if (!this.page || !this.chatPage || !this.onMessage || this.state !== "ready") {
      throw new Error("X is not ready");
    }
    if (Date.now() < this.inboxRetryAt) {
      throw new Error(
        `X is cooling down until ${new Date(this.inboxRetryAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}`
      );
    }
    if (this.busy) throw new Error("X is already syncing. Try again in a moment");

    const historyPaceMs = Math.max(
      30000,
      Number(process.env.X_HISTORY_PACE_MS || 60000)
    );
    const historyWaitMs = this.lastHistoryRequestAt + historyPaceMs - Date.now();
    if (historyWaitMs > 0) {
      throw new Error(
        `X history is being paced. Try again in ${Math.ceil(historyWaitMs / 1000)} seconds`
      );
    }
    this.lastHistoryRequestAt = Date.now();

    const run = ++this.pageRun;
    this.busy = true;
    try {
      const generalConversations = await this.scrapeConversations(this.page);
      const requestConversations = await this.scrapeConversations(
        this.requestPage,
        0,
        "spam"
      );
      const conversation = [...generalConversations, ...requestConversations].find(
        (item) => item.id === chatExternalId
      ) || {
        id: chatExternalId,
        name: "X user",
        handle: chatExternalId,
        preview: "",
        inboxCategory: context?.inboxCategory || ("general" as const),
      };
      const stored = this.accountId ? await prisma.conversation.findFirst({
        where: { platform: "x", accountId: this.accountId, externalId: chatExternalId },
        select: { inboxCategory: true, contact: { select: { name: true, handle: true, isGroup: true } } },
      }) : null;
      // A saved request may have been accepted since it entered the durable
      // queue. Don't repeatedly search the Requests view after promotion.
      if (stored?.inboxCategory === "general") conversation.inboxCategory = "general";
      const requestedHistoryDays = context?.sinceTimestamp
        ? Math.max(1, (Date.now() - context.sinceTimestamp) / (24 * 60 * 60 * 1000))
        : 0;
      const requestedScrolls = context?.sinceTimestamp
        ? requestedHistoryDays <= 1
          ? 12
          : requestedHistoryDays <= 7
            ? 24
            : 40
        : 40;
      const saveWindow = async (messages: ScrapedMessage[]) => {
        await this.persistMessageWindow(chatExternalId, messages, {
          inboxCategory: conversation.inboxCategory,
          isGroup: stored?.contact.isGroup || chatExternalId.startsWith("g"),
          name: conversation.name !== "X user" ? conversation.name : stored?.contact.name || conversation.name,
          handle: stored?.contact.handle || conversation.handle || conversation.name,
        }, () => run === this.pageRun && !this.stopping && this.outboundPending === 0);
      };
      const readHistory = (isRequest: boolean) => this.scrapeMessages(
        chatExternalId,
        // Longer explicit windows progressively load more history while still
        // retaining a hard ceiling so a single repair cannot hammer X.
        requestedScrolls,
        isRequest,
        undefined,
        { sinceTimestamp: context?.sinceTimestamp, beforeTimestamp: _oldestTimestamp || undefined, count: Math.max(1, Math.min(500, _count)), targetId: context?.targetMessageId,
          latest: (!context?.targetMessageId && (context?.sinceTimestamp || !_oldestTimestamp) && "direction" in conversation) ? conversation as XLatestPreview : undefined },
        saveWindow
      );
      let history;
      try {
        history = await readHistory(conversation.inboxCategory === "spam");
      } catch (error) {
        // Accepting a request on the phone can move it out of Requests before
        // our rotating discovery reaches it. Try the SAME native ID in General
        // once, never on rate limits/timeouts and never send or accept anything.
        if (conversation.inboxCategory !== "spam" || !String(error).includes("X request conversation was not found")) throw error;
        this.assertNotCoolingDown();
        conversation.inboxCategory = "general";
        history = await readHistory(false);
      }
      const { messages, covered } = history;
      const { undated, unavailableAttachments } = await this.persistMessageWindow(chatExternalId, messages, {
        inboxCategory: conversation.inboxCategory,
        isGroup: stored?.contact.isGroup || chatExternalId.startsWith("g"),
        name: conversation.name !== "X user" ? conversation.name : stored?.contact.name || conversation.name,
        handle: stored?.contact.handle || conversation.handle || conversation.name,
      }, () => run === this.pageRun && !this.stopping && this.outboundPending === 0);
      if (this.accountId && "timestamp" in conversation && conversation.timestamp) {
        await reconcileXConversationTime(this.accountId, chatExternalId, conversation.timestamp);
      }
      if (this.accountId) {
        const dated = messages.filter(message => message.timestamp);
        const coverage = covered && !undated && dated.length > 1 &&
          (!("direction" in conversation) || xHistoryMatchesPreview(messages, conversation as XLatestPreview))
          ? { since: Math.min(...dated.map(message => message.timestamp!)), until: Math.max(...dated.map(message => message.timestamp!)) } : undefined;
        const removed = await coalesceXPreviewRuns(prisma, this.accountId, chatExternalId) +
          await reconcileXPreviewCopies(prisma, this.accountId, chatExternalId, dated.map(message => `x:${message.id}`), coverage) +
          (covered && !undated && "direction" in conversation && xHistoryMatchesPreview(messages, conversation as XLatestPreview)
            ? await reconcileXVerifiedSnapshot(prisma, this.accountId, chatExternalId, { preview: conversation.preview, direction: conversation.direction, checkedAt: Date.now() }) : 0);
        if (removed) console.log(`[x] reconciled ${removed} duplicate inbox previews; recovery copies saved`);
      }
      console.log(`[x] history saved ${messages.length - undated}/${messages.length} dated messages`);
      if (undated) throw new Error(`X did not expose dates for ${undated} messages; preserved existing history instead of assigning today's date`);
      if (unavailableAttachments) throw new Error(`Messages saved, but X has not made ${unavailableAttachments} attachments available to download yet`);
      if ((context?.sinceTimestamp || !_oldestTimestamp) && "direction" in conversation && !xHistoryMatchesPreview(messages, conversation as XLatestPreview)) throw new Error("X saved older history, but its latest inbox message has not loaded yet; repair remains pending");
      if (!covered) throw new Error("X saved the available messages, but the full requested range was not reached in this paced pass");
    } finally {
      if (run === this.pageRun) this.busy = false;
      if (run === this.pageRun) await this.parkActionPage(this.chatPage);
      if (run === this.pageRun && !this.stopping && this.outboundPending === 0 && Date.now() >= this.inboxRetryAt) {
        await this.page?.bringToFront().catch(() => null);
      }
    }
  }

  async recoverMedia(chatExternalId: string, messageExternalId: string): Promise<void> {
    const id = messageExternalId.replace(/^x:/, "").replace(/:attachment:\d+$/, "");
    if (!/^(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i.test(id)) throw new Error("This X attachment does not have a native message ID yet. Backfill the chat first.");
    const conversation = await prisma.conversation.findFirst({ where: { platform: "x", externalId: chatExternalId, ...(this.accountId ? { accountId: this.accountId } : {}) }, select: { inboxCategory: true } });
    this.attachmentRetryAt.delete(messageExternalId);
    this.attachmentCache.delete(messageExternalId);
    await this.requestHistory(chatExternalId, "", 0, 1, { inboxCategory: conversation?.inboxCategory === "spam" ? "spam" : "general", targetMessageId: id });
  }

  async editMessage(chat: string, key: string, body: string, context?: { expectedBody: string }): Promise<void> {
    return this.mutateMessage(chat, key, "edit", context, body);
  }

  async deleteMessage(chat: string, key: string, context?: { expectedBody: string }): Promise<void> {
    return this.mutateMessage(chat, key, "delete", context);
  }

  private mutateMessage(chat: string, key: string, action: MessageMutationAction, context?: { expectedBody: string }, body?: string): Promise<void> {
    if (!context || typeof context.expectedBody !== "string") return Promise.reject(new MessageMutationRejected("The original X message is required."));
    if (!/^[\w-]{1,150}$/.test(chat) || !isNativeXMutationKey(key)) return Promise.reject(new MessageMutationRejected("This message has no verified native X identity."));
    const queuedAt = Date.now();
    return this.enqueueOutbound(async () => {
      // Never execute a destructive action long after its requesting UI timed out.
      if (Date.now() - queuedAt > 15000) throw new MessageMutationRejected("X was busy sending another message. Please try again.");
      try { await this.ensureReady(); } catch (error) { throw new MessageMutationRejected(String(error).replace(/^Error: /, "")); }
      const page = this.sendPage!;
      const run = ++this.pageRun;
      this.busy = true;
      try {
        // Mutation never accepts a request or chooses a different account.
        try { await this.openGeneralConversation(page, chat, false); }
        catch (error) { throw new MessageMutationRejected(`X could not open this exact chat. ${String(error).replace(/^Error: /, "")}`); }
        await mutateXMessage(page, { chat, key, action, body, expectedBody: context.expectedBody }, () => {
          this.assertNotCoolingDown();
          if (Date.now() - queuedAt > 60000) throw new Error("X took too long to prepare or confirm this action. Check the native chat.");
          if (this.stopping || run !== this.pageRun) throw new Error("X connection changed during the action.");
        });
      } finally { if (run === this.pageRun) this.busy = false; }
    });
  }

  async send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    _mentions?: string[],
    _replyToExternalId?: string,
    context?: OutboundSendContext
  ): Promise<SentMessage> {
    const startedAt = Date.now();
    return this.enqueueOutbound(() => this.performSend(chatExternalId, body, media, context)).then(sent => {
      console.log(`[x] sent ${chatExternalId} in ${Date.now() - startedAt}ms`);
      return sent;
    });
  }

  private enqueueOutbound<T>(task: () => Promise<T>): Promise<T> {
    if (this.sendPageIdleTimer) {
      clearTimeout(this.sendPageIdleTimer);
      this.sendPageIdleTimer = undefined;
    }
    this.outboundPending += 1;
    const operation = this.outboundQueue
      .then(task)
      .finally(async () => {
        this.outboundPending = Math.max(0, this.outboundPending - 1);
        if (this.outboundPending === 0) {
          if (Date.now() < this.inboxRetryAt) {
            // A first parking pass may have intentionally skipped these
            // sending pages. Finish it before taking a fresh all-pages pass.
            await this.cooldownParkPromise;
            await this.parkForCooldown();
          } else this.scheduleSendPagePark();
        }
      });
    this.outboundQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async performSend(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    context?: OutboundSendContext
  ): Promise<SentMessage> {
    await this.ensureReady();
    const requestSend = context?.inboxCategory === "spam";
    const requestPage = requestSend ? this.requestPage : undefined;
    const sendPage = this.sendPage;
    if (!sendPage || (requestSend && !requestPage)) {
      throw new Error("X is reconnecting");
    }
    const run = ++this.pageRun;
    this.busy = true;
    try {
      if (requestSend) {
        const generalPath = `/i/chat/${chatExternalId}`;
        const alreadyPromoted =
          new URL(sendPage.url()).pathname === generalPath ||
          Boolean(await sendPage.$(xchatSelector(`a[href="${generalPath}"]`)));
        if (!alreadyPromoted) {
          try {
            // The request page is kept warm and already rendered. If its row
            // is absent after a short grace period, X has almost certainly
            // promoted it already; the regular inbox is the source of truth.
            await this.openRequestConversation(requestPage!, chatExternalId, 1800);
            const acceptSelector =
              '[data-testid="dm-message-request-accept-button"]';
            const acceptButton = await requestPage!.$(
              xchatSelector(acceptSelector)
            );
            if (acceptButton) {
              this.assertNotCoolingDown();
              // X ignores synthetic HTMLElement.click() for this encrypted-chat
              // action on some sessions. Puppeteer's click emits a trusted mouse
              // event so the request is actually promoted to the regular inbox.
              await requestPage!.click(xchatSelector(acceptSelector));
              const acceptDeadline = Date.now() + 15000;
              while (
                Date.now() < acceptDeadline &&
                (await requestPage!.$(xchatSelector(acceptSelector)))
              ) {
                await delay(150);
              }
              if (await requestPage!.$(xchatSelector(acceptSelector))) {
                throw new Error("X did not finish accepting the message request");
              }
            }
          } catch (requestError) {
            // X may promote a request to the regular inbox before the next CRM
            // sync. The regular route below is the source of truth, so a missing
            // request row is safe to recover from; genuine browser failures still
            // surface if the regular conversation cannot be opened.
            console.log(
              `[x] request ${chatExternalId} was already promoted or changed: ${String(
                requestError
              ).replace(/^Error:\s*/, "")}`
            );
          }
        } else {
          console.log(
            `[x] request ${chatExternalId} is already in the regular inbox`
          );
        }
        // After Accept, X briefly mounts a composer inside the request route
        // and then replaces it while promoting the chat. Typing into that
        // transient node caused the observed detached-composer timeout. Send
        // from the dedicated, stable regular-chat page instead.
        await this.openGeneralConversation(sendPage, chatExternalId);
      } else {
        await this.openGeneralConversation(sendPage, chatExternalId);
      }
      return await this.sendFromOpenConversation(
        sendPage,
        chatExternalId,
        body,
        media
      );
    } finally {
      if (requestPage) {
        await this.restoreRequestList(requestPage).catch((error) =>
          console.error("[x] request list restore after send failed:", error)
        );
      }
      if (run === this.pageRun) this.busy = false;
    }
  }

  private async sendFromOpenConversation(
    page: Page,
    chatExternalId: string,
    body: string,
    media?: OutboundMedia
  ): Promise<SentMessage> {
    let stage = "finding composer";
    const startedAt = Date.now();
    try {
      // XChat's current composer is a textarea. Keep the older selectors as
      // fallbacks because X rolls interface revisions out per account.
      const composerSelector = [
        '[data-testid="dm-composer-textarea"]',
        'textarea[aria-label="Message"]',
        '[data-testid="dm-conversation-panel"] [contenteditable="true"]',
        '[data-testid="dm-conversation-panel"] [role="textbox"]',
        '[data-testid="dmComposerTextInput"]',
      ].join(",");
      const composerDeadline = Date.now() + 30000;
      let composerReady = false;
      while (Date.now() < composerDeadline) {
        composerReady = await page
          .$eval(xchatSelector(composerSelector), (element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .catch(() => false);
        if (composerReady) break;
        await delay(150);
      }
      if (!composerReady) throw new Error("XChat composer not found");
      await page.bringToFront();
      stage = "preparing message";

      // XChat replaces its controlled textarea while the conversation finishes
      // hydrating. Never retain that ElementHandle for typing: it may detach
      // between the initial wait and the first click. Resolve the current node
      // for every attempt and retry the trusted click if hydration swaps it.
      const focusLiveComposer = async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await page.click(xchatSelector(composerSelector));
            return;
          } catch (error) {
            lastError = error;
            if (!/detached|not clickable|no element/i.test(String(error))) throw error;
            await delay(250);
          }
        }
        throw lastError;
      };

      // Remember the rendered messages before sending. XChat later exposes the
      // real UUID in the new bubble; returning that UUID lets the worker and
      // the subsequent inbox echo converge on one local message row.
      const beforeMessageIds = new Set(
        await page.evaluate(() => {
          const root =
            document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
              ?.shadowRoot ?? document;
          return Array.from(root.querySelectorAll('[data-testid^="message-text-"]'))
            .map((element) =>
              (element.getAttribute("data-testid") || "").replace("message-text-", "")
            )
            .filter(Boolean);
        })
      );

      // Attach a photo/video by driving the hidden file input, then wait for
      // the preview to attach before sending.
      if (media) {
        stage = "attaching media";
        const fileInput = (await page.$(
          xchatSelector('input[data-testid="dm-composer-file-input"]')
        )) || (await page.$(
          xchatSelector('input[data-testid="fileInput"]')
        )) || (await page.$(xchatSelector('input[type="file"]')));
        if (!fileInput) throw new Error("X file input not found");
        await (fileInput as any).uploadFile(media.path);
        await delay(2500);
      }

      await focusLiveComposer();
      if (body) {
        stage = "typing message";
        const setComposerText = (text: string) =>
          page.$eval(
            xchatSelector(composerSelector),
            (element, value) => {
              if (
                element instanceof HTMLTextAreaElement ||
                element instanceof HTMLInputElement
              ) {
                const prototype =
                  element instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
                if (!setter) throw new Error("XChat input setter is unavailable");
                setter.call(element, value);
              } else {
                element.textContent = value;
              }
              element.dispatchEvent(new Event("input", { bubbles: true }));
            },
            text
          );

        // Keyboard shortcuts were unreliable in XChat: Select All was ignored
        // for recovered drafts, and fast native typing occasionally dropped a
        // repeated character. Use the browser's native value setter and React's
        // input event so replacing a draft is exact and atomic.
        await setComposerText(body);
        // Puppeteer's in-page waiter can stop observing XChat's controlled
        // textarea even while the draft is present. Read the live value from
        // Node instead so verification does not depend on the page's polling
        // scheduler or animation frames.
        const normalizeComposerText = (text: string) =>
          text.replace(/\s+/g, " ").trim();
        const expectedText = normalizeComposerText(body);
        const readComposerText = () =>
          page.$eval(xchatSelector(composerSelector), (element) =>
            "value" in element
              ? String((element as HTMLTextAreaElement | HTMLInputElement).value)
              : element.textContent || ""
          );
        const waitForExactDraft = async (timeoutMs: number) => {
          const deadline = Date.now() + timeoutMs;
          let value = "";
          while (Date.now() < deadline) {
            value = await readComposerText();
            if (normalizeComposerText(value) === expectedText) break;
            await delay(100);
          }
          return value;
        };
        let actualText = await waitForExactDraft(1500);
        if (normalizeComposerText(actualText) !== expectedText) {
          await focusLiveComposer();
          await setComposerText("");
          await delay(100);
          await setComposerText(body);
          actualText = await waitForExactDraft(3000);
        }
        if (normalizeComposerText(actualText) !== expectedText) {
          throw new Error(
            `XChat composer did not retain the full draft (expected ${body.length} characters, found ${actualText.length})`
          );
        }
      }

      const sendButtonSelector = [
        '[data-testid="dm-composer-send-button"]',
        'button[aria-label="Send"]',
        '[data-testid="dmComposerSendButton"]',
      ].join(",");
      stage = "waiting for Send button";
      const sendButtonDeadline = Date.now() + 10000;
      let sendButtonReady = false;
      while (Date.now() < sendButtonDeadline) {
        sendButtonReady = await page
          .$eval(xchatSelector(sendButtonSelector), (button) => {
            const element = button as HTMLButtonElement;
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              !element.disabled &&
              element.getAttribute("aria-disabled") !== "true"
            );
          })
          .catch(() => false);
        if (sendButtonReady) break;
        await delay(100);
      }
      if (!sendButtonReady) throw new Error("XChat Send button did not become ready");
      this.assertNotCoolingDown();
      // Use Puppeteer's trusted mouse event. Calling element.click() inside the
      // page occasionally cleared X's composer without committing the XChat
      // mutation, especially for messages containing links.
      // X can replace the enabled button during its final composer render.
      // Resolve it again and retry only failures that happen before Puppeteer
      // can dispatch a click; other errors remain uncertain and must not be
      // retried because X may already have accepted the message.
      let sendClickError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await page.click(xchatSelector(sendButtonSelector));
          sendClickError = undefined;
          break;
        } catch (error) {
          sendClickError = error;
          if (!/detached|not clickable|not an Element|no element/i.test(String(error))) {
            throw error;
          }
          await delay(200);
        }
      }
      if (sendClickError) throw sendClickError;
      const sentAt = Date.now();
      stage = "waiting for X acceptance";

      // XChat clears its controlled composer only after the native Send action
      // has been accepted. Its outgoing bubble/UUID is often rendered several
      // seconds later (and sometimes only appears on the inbox echo), so using
      // that bubble as the only success signal produced false delivery errors.
      // Prefer the real UUID when it is already available; otherwise return a
      // unique provisional key which the normal echo reconciliation replaces.
      let confirmedMessage: ScrapedMessage | undefined;
      const isGroupChat = chatExternalId.startsWith("g");
      let acceptedWithoutId = false;
      const confirmationResult = await waitForXSendConfirmation(async (): Promise<XSendConfirmation> => {
        // One reader for history AND send receipts; otherwise native timestamp
        // wrappers can break receipt matching while history uses clean text.
        const rows = await page.evaluate(readXMessageDom).catch(() => []);
        const native = rows.reverse().find(row => row.direction === "out" && !beforeMessageIds.has(row.id) &&
          (!body || normalizeXMessageText(row.text) === normalizeXMessageText(body)));
        if (native) return { kind: "message", id: native.id, text: native.text };
        const value = await page.$eval(xchatSelector(composerSelector), element =>
          "value" in element ? String((element as HTMLTextAreaElement).value) : element.textContent || ""
        ).catch(() => null);
        return value !== null && !value.trim() ? { kind: "accepted" } : false;
      },
        isGroupChat ? 12_000 : 8_000
      );
      if (confirmationResult && confirmationResult.kind === "message") {
        confirmedMessage = {
          id: confirmationResult.id,
          text: confirmationResult.text || body,
          direction: "out",
        };
      } else if (confirmationResult && confirmationResult.kind === "accepted") {
        acceptedWithoutId = true;
      } else {
        // Even if the richer bubble scan fails, an empty controlled composer
        // is XChat's native acknowledgement that the trusted Send click was
        // accepted. Keep this independent of the browser callback so a future
        // page-script serialization issue cannot turn a successful send into
        // an error again.
        const composerValue = await page
          .$eval(xchatSelector(composerSelector), (element) =>
            "value" in element
              ? String((element as HTMLTextAreaElement | HTMLInputElement).value)
              : element.textContent || ""
          )
          .catch(() => null);
        if (composerValue !== null && !composerValue.trim()) {
          acceptedWithoutId = true;
        }
      }
      if (!confirmedMessage && !acceptedWithoutId) {
        throw new Error("XChat delivery confirmation timed out after pressing Send");
      }
      if (!confirmedMessage && acceptedWithoutId) {
        // Give X a brief chance to surface a rejection or restored draft.
        await delay(300);
        const rejection = await page.evaluate((composer) => {
          const root =
            document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
              ?.shadowRoot ?? document;
          const input = root.querySelector(composer) as
            | HTMLTextAreaElement
            | HTMLInputElement
            | HTMLElement
            | null;
          const value = input
            ? "value" in input
              ? String(input.value)
              : input.textContent || ""
            : "";
          const visibleAlerts = Array.from(
            root.querySelectorAll('[role="alert"],[aria-live="assertive"]')
          ).filter((element) => {
            const rect = (element as HTMLElement).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const errorText = visibleAlerts
            .map((element) => element.textContent || "")
            .find((text) =>
              /failed|couldn.t send|not sent|try again|something went wrong/i.test(
                text
              )
            );
          return {
            composerEmpty: !value.trim(),
            errorText: errorText?.trim() || "",
          };
        }, composerSelector);
        if (rejection.errorText) throw new Error(rejection.errorText);
        if (!rejection.composerEmpty) {
          throw new Error("XChat restored the draft instead of accepting it");
        }
      }
      if (confirmedMessage) this.nativeMessageTimes.set(confirmedMessage.id, sentAt);
      return {
        messageExternalId: confirmedMessage
          ? `x:${confirmedMessage.id}`
          : `x:${chatExternalId}:pending:${sentAt}:${randomUUID()}`,
        timestamp: new Date(sentAt).toISOString(),
      };
    } catch (error) {
      throw new Error(
        `${stage} failed after ${Date.now() - startedAt}ms: ${String(error).replace(
          /^Error:\s*/,
          ""
        )}`
      );
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.lifecycleVersion += 1;
    this.pageRun += 1;
    this.busy = false;
    this.state = "disconnected";
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = undefined;
    this.reconnectTimer = undefined;
    this.reconnecting = false;
    if (this.automaticRepairTimer) clearTimeout(this.automaticRepairTimer);
    this.automaticRepairTimer = undefined;
    this.persistRepairState();
    this.automaticRepairQueue.clear();
    if (this.sendPageIdleTimer) clearTimeout(this.sendPageIdleTimer);
    this.sendPageIdleTimer = undefined;
    const browser = this.browser;
    const browserPid = browser?.process()?.pid;
    this.browser = undefined;
    this.page = undefined;
    this.requestPage = undefined;
    this.chatPage = undefined;
    this.sendPage = undefined;
    try {
      await browser?.close();
    } finally {
      this.clearBrowserPid(browserPid);
    }
  }
}
