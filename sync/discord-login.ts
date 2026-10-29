import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import { activateDiscordSearch } from "./discord-search-account";

const folder = path.join(process.env.DATA_DIR || process.cwd(), ".local", "discord-login");
const statusFile = path.join(folder, "status.json");
async function status(state: string, detail: string, extra: Record<string, unknown> = {}) {
  await fs.writeFile(`${statusFile}.tmp`, JSON.stringify({ version: 2, state, detail, updatedAt: Date.now(), pid: process.pid, ...extra }), { mode: 0o600 });
  await fs.rename(`${statusFile}.tmp`, statusFile);
}
async function main() {
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const lock = path.join(folder, "lock");
  try { await fs.mkdir(lock); } catch {
    // A live login must not be interrupted or launched twice. Stale locks can
    // only be removed after verifying that their recorded process is gone.
    const prior = JSON.parse(await fs.readFile(statusFile, "utf8").catch(() => "{}"));
    if (prior.pid) { try { process.kill(prior.pid, 0); return; } catch { /* exited */ } }
    await fs.rmdir(lock).catch(() => undefined);
    await fs.mkdir(lock);
  }
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let done = false;
  const finish = async () => { if (done) return; done = true; await browser?.close().catch(() => undefined); await fs.rmdir(lock).catch(() => undefined); };
  process.once("SIGTERM", () => { void finish().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void finish().finally(() => process.exit(0)); });
  try {
    await status("starting", "Opening Discord’s sign-in window…");
    browser = await puppeteer.launch({ headless: false, channel: "chrome", userDataDir: path.join(folder, "profile"), defaultViewport: null,
      // Keep Chrome's normal sandbox, phishing protection, and OS keychain.
      ignoreDefaultArgs: true, args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    process.on("SIGUSR1", () => { void page.bringToFront().catch(() => undefined); });
    let verifying = false;
    let lastAttempt = "";
    let nextAttemptAt = 0;
    await status("waiting", "Sign in to Discord in the opened window. You can scan its QR using your Discord phone app.");
    let resolveLogin: () => void;
    let rejectLogin: (error: Error) => void;
    const loggedIn = new Promise<void>((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; });
    // Attach immediately so closing a window during navigation is not an
    // unhandled rejection. The awaited race below still reports the failure.
    void loggedIn.catch(() => undefined);
    browser.on("disconnected", () => { if (!done) rejectLogin(new Error("Discord sign-in window closed.")); });
    page.on("request", request => {
      // Observe only authentication used by THIS user-opened Discord window,
      // never third-party origins, page storage, user-agent cookies, or passwords.
      const url = new URL(request.url());
      if (url.origin !== "https://discord.com" || !/^\/api\/v\d+\//.test(url.pathname) || request.method() !== "GET") return;
      const token = request.headers().authorization;
      if (!token || token === lastAttempt || verifying || done || Date.now() < nextAttemptAt) return;
      lastAttempt = token; verifying = true;
      void activateDiscordSearch(token).then(async result => {
        await status("connected", `@${result.username} connected for read-only search. History is indexing in the background.`, result);
        resolveLogin();
      }).catch(async () => { lastAttempt = ""; nextAttemptAt = Date.now() + 10_000; await status("waiting", "That session could not connect. Finish signing in to your personal Discord account."); }).finally(() => { verifying = false; });
    });
    await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 60_000 });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error("Discord sign-in timed out. Reopen the connection window to try again.")), 15 * 60_000); });
    try { await Promise.race([loggedIn, timeout]); } finally { clearTimeout(timer!); }
  } catch (error) {
    await status("error", error instanceof Error && /timed out/.test(error.message) ? "Discord sign-in timed out. Open the sign-in window again." : "Could not finish Discord sign-in. Reopen the window and try again.");
  } finally { await finish(); }
}
void main().catch(() => { process.exitCode = 1; });
