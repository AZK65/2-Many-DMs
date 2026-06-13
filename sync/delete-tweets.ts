import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { Browser, Page } from "puppeteer";
import puppeteer, { REAL_UA } from "./x-browser";
import { cleanChromeLocks } from "./chrome-locks";
import { FingerprintGenerator } from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";

/*
  Find and delete YOUR OWN tweets that contain a keyword.

  Reuses the X login session from `npm run x:login` (cookies in .x_auth/cookies.json,
  or the X_AUTH_TOKEN + X_CT0 env fallback). Like adapters/x.ts, it drives a real
  logged-in browser rather than hitting X's API directly — far less likely to trip
  bot detection on a destructive action.

  DRY RUN by default: it lists matches and stops. Pass --confirm to actually delete.

  Usage:
    npm run x:clean-tweets -- "keyword"              # dry run, just lists matches
    npm run x:clean-tweets -- "keyword" --confirm    # actually deletes
    KEYWORD="black friday" npm run x:clean-tweets -- --confirm

  Options (CLI flags or env):
    --confirm            actually delete (default: dry run)            DELETE_CONFIRM=1
    --handle <handle>    your @handle (auto-detected if omitted)        X_HANDLE
    --max <n>            stop after deleting n tweets (default 1000)     MAX_DELETE
    --headless           run without a visible window (default: headful so you can watch)
    --case-sensitive     match case-sensitively (default: insensitive)
*/

const AUTH_FILE = path.join(process.cwd(), ".x_auth", "cookies.json");

/* eslint-disable @typescript-eslint/no-explicit-any */
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

// X's own search does the filtering server-side: `from:<handle> <keyword>`
// returns only your tweets containing the keyword, so we never touch your
// general feed. f=live = Latest (chronological, all results) rather than Top.
function searchUrl(handle: string, keyword: string): string {
  const q = `from:${handle} ${keyword}`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}

// A consistent realistic browser fingerprint, persisted so it doesn't shift
// each run (a fingerprint that changes every launch is itself a detection
// signal). Same approach as adapters/x.ts. Layered on top of the stealth plugin.
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

function parseArgs() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const getOpt = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const keyword = positional[0] || process.env.KEYWORD || "";
  return {
    keyword,
    confirm: flags.has("--confirm") || process.env.DELETE_CONFIRM === "1",
    handle: (getOpt("handle") || process.env.X_HANDLE || "").replace(/^@/, ""),
    max: Number(getOpt("max") || process.env.MAX_DELETE || 1000),
    headless: flags.has("--headless"),
    caseSensitive: flags.has("--case-sensitive"),
  };
}

function confirmPrompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    })
  );
}

// One scan of the tweets currently in the DOM on a profile timeline.
// Returns only original tweets/replies authored by `handle` (skips reposts).
async function scanTimeline(page: Page, handle: string) {
  return page.evaluate((myHandle: string) => {
    const articles = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]')
    ) as HTMLElement[];
    const out: { id: string; text: string }[] = [];
    for (const art of articles) {
      // Skip reposts — those are someone else's tweet you reposted; deleting
      // them is a different action ("Undo repost"), not what we want here.
      const social = art.querySelector('[data-testid="socialContext"]') as HTMLElement | null;
      if (social && /repost/i.test(social.innerText || "")) continue;

      // Permalink → status id (also used to locate the article for deletion).
      const link = art.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
      const m = link?.getAttribute("href")?.match(/\/status\/(\d+)/);
      const id = m?.[1];
      if (!id) continue;

      // Verify this tweet is authored by us. The User-Name block holds @handle.
      const nameBlock = art.querySelector('[data-testid="User-Name"]') as HTMLElement | null;
      const authored = (nameBlock?.innerText || art.innerText || "")
        .toLowerCase()
        .includes("@" + myHandle.toLowerCase());
      if (!authored) continue;

      const textEl = art.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
      const text = (textEl?.innerText || "").trim();
      out.push({ id, text });
    }
    return out;
  }, handle);
}

// Delete a single tweet identified by its status id: open its "..." menu,
// click Delete, confirm. Returns true on success.
async function deleteById(page: Page, id: string): Promise<boolean> {
  // Find the article whose permalink matches this id, then click its caret.
  const opened = await page.evaluate((statusId: string) => {
    const articles = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]')
    ) as HTMLElement[];
    for (const art of articles) {
      const link = art.querySelector(`a[href*="/status/${statusId}"]`);
      if (!link) continue;
      const caret =
        (art.querySelector('[data-testid="caret"]') as HTMLElement | null) ||
        (art.querySelector('[aria-label="More"]') as HTMLElement | null);
      if (caret) {
        art.scrollIntoView({ block: "center" });
        caret.click();
        return true;
      }
    }
    return false;
  }, id);
  if (!opened) return false;

  await delay(600);

  // Click the "Delete" item in the dropdown menu.
  const clickedDelete = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('[role="menuitem"]')
    ) as HTMLElement[];
    const del = items.find((el) => /^\s*delete\s*$/i.test(el.innerText || ""));
    if (del) {
      del.click();
      return true;
    }
    return false;
  });
  if (!clickedDelete) {
    // Close any open menu and bail on this one.
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }

  await delay(500);

  // Confirm in the dialog.
  const confirm =
    (await page.$('[data-testid="confirmationSheetConfirm"]')) || null;
  if (confirm) {
    await confirm.click();
    await delay(1500);
    return true;
  }
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

async function main() {
  const opts = parseArgs();
  if (!opts.keyword) {
    console.error(
      'No keyword given.\n  Usage: npm run x:clean-tweets -- "keyword" [--confirm]'
    );
    process.exit(1);
  }

  const cookies = loadCookies();
  if (!cookies) {
    console.error(
      "No X session — run `npm run x:login`, or set X_AUTH_TOKEN + X_CT0 from your browser cookies."
    );
    process.exit(1);
  }

  const match = (text: string) =>
    opts.caseSensitive
      ? text.includes(opts.keyword)
      : text.toLowerCase().includes(opts.keyword.toLowerCase());

  // Reuse the same persistent profile the X adapter uses, so this looks like
  // your real, already-trusted browser session rather than a fresh automated
  // one. Default to your installed Google Chrome (channel "chrome") — the
  // bundled "Chrome for Testing" build is what X's bot detection flags. Set
  // X_CHROME_CHANNEL="" to force the bundled Chromium if you ever need to.
  const profileDir = path.join(process.env.DATA_DIR || process.cwd(), ".x_profile");
  cleanChromeLocks(profileDir);
  // Default to your installed Google Chrome — the bundled "Chrome for Testing"
  // build is what X's bot detection flags. An empty X_CHROME_CHANNEL in .env
  // still means "use real Chrome"; set it to "bundled" to force Chromium.
  const envChannel = (process.env.X_CHROME_CHANNEL || "").trim();
  const channel = envChannel === "bundled" ? undefined : envChannel || "chrome";

  const browser: Browser = await puppeteer.launch({
    headless: opts.headless,
    defaultViewport: opts.headless ? { width: 1280, height: 900 } : null,
    userDataDir: profileDir,
    channel: channel as any,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    // Inject a consistent realistic fingerprint (UA, navigator/WebGL overrides)
    // on top of the stealth plugin — the same anti-detection layering as the
    // X adapter. Falls back to a plain UA if injection fails.
    try {
      await new FingerprintInjector().attachFingerprintToPuppeteer(
        page,
        loadOrCreateFingerprint()
      );
    } catch {
      await page.setUserAgent(REAL_UA);
      await page.setViewport({ width: 1280, height: 900 });
    }
    await page.setCookie(...cookies);

    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    await delay(4000);

    if (/\/login|\/i\/flow/.test(page.url())) {
      console.error("Session invalid/expired — run `npm run x:login` again.");
      process.exit(1);
    }

    // Auto-detect handle from the Profile nav link if not provided.
    let handle = opts.handle;
    if (!handle) {
      handle = await page.evaluate(() => {
        const a = document.querySelector(
          'a[data-testid="AppTabBar_Profile_Link"]'
        ) as HTMLAnchorElement | null;
        return (a?.getAttribute("href") || "").replace(/^\//, "");
      });
    }
    if (!handle) {
      console.error(
        "Couldn't auto-detect your handle. Pass it explicitly: --handle yourhandle"
      );
      process.exit(1);
    }
    console.log(`Account: @${handle}`);
    console.log(`Keyword: "${opts.keyword}" (${opts.caseSensitive ? "case-sensitive" : "case-insensitive"})`);
    console.log(opts.confirm ? "Mode: DELETE\n" : "Mode: DRY RUN (no deletions — pass --confirm to delete)\n");

    await page.goto(searchUrl(handle, opts.keyword), { waitUntil: "domcontentloaded" });
    await delay(4000);

    // ---- DRY RUN: page through the search results, collect & print matches ----
    if (!opts.confirm) {
      const seen = new Map<string, string>();
      let lastHeight = 0;
      let stagnant = 0;
      while (stagnant < 4) {
        for (const t of await scanTimeline(page, handle)) {
          if (!seen.has(t.id) && match(t.text)) seen.set(t.id, t.text);
        }
        const h = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await delay(1500);
        if (h === lastHeight) stagnant++;
        else stagnant = 0;
        lastHeight = h;
      }
      console.log(`Found ${seen.size} of your tweets matching "${opts.keyword}":\n`);
      let n = 1;
      for (const [id, text] of seen) {
        const preview = text.replace(/\s+/g, " ").slice(0, 100);
        console.log(`  ${n++}. [${id}] ${preview}${text.length > 100 ? "…" : ""}`);
      }
      console.log(
        `\nThis was a DRY RUN. To delete these ${seen.size} tweets, re-run with --confirm.`
      );
      await browser.close();
      process.exit(0);
    }

    // ---- DELETE MODE ----
    console.log(
      `About to permanently delete YOUR tweets containing "${opts.keyword}" (up to ${opts.max}).`
    );
    const ok = await confirmPrompt("This cannot be undone. Type 'yes' to proceed: ");
    if (!ok) {
      console.log("Aborted. Nothing deleted.");
      await browser.close();
      process.exit(0);
    }

    let deleted = 0;
    const failed: string[] = [];
    const processed = new Set<string>();
    let stagnantScrolls = 0;

    // Re-scan each pass: deleting reflows the virtualized results list, so we
    // always act on a fresh view. Stop when several scrolls in a row surface
    // nothing new (i.e. we've exhausted the search results).
    while (deleted < opts.max && stagnantScrolls < 5) {
      const matches = (await scanTimeline(page, handle)).filter(
        (t) => match(t.text) && !processed.has(t.id)
      );

      if (matches.length === 0) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await delay(1500);
        stagnantScrolls++;
        continue;
      }
      stagnantScrolls = 0;

      const target = matches[0];
      processed.add(target.id);
      const preview = target.text.replace(/\s+/g, " ").slice(0, 80);
      process.stdout.write(`Deleting [${target.id}] ${preview}… `);
      const success = await deleteById(page, target.id);
      if (success) {
        deleted++;
        console.log(`✅ (${deleted})`);
      } else {
        failed.push(target.id);
        console.log("⚠️  could not delete (skipped)");
      }
      await delay(1200);
    }

    console.log(`\nDone. Deleted ${deleted} tweet(s).`);
    if (deleted >= opts.max) console.log(`Hit the --max ${opts.max} cap; re-run to continue.`);
    if (failed.length) console.log(`${failed.length} could not be deleted: ${failed.join(", ")}`);
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error(e);
    await browser.close();
    process.exit(1);
  }
}

main();
