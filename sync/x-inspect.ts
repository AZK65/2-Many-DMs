import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { REAL_UA } from "./x-browser";

const DIR = path.join(process.cwd(), ".x_auth");
const PROFILE = path.join(process.cwd(), ".x_profile");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadCookies(): any[] | null {
  const file = path.join(DIR, "cookies.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const t = process.env.X_AUTH_TOKEN, c = process.env.X_CT0;
  if (t && c)
    return [
      { name: "auth_token", value: t, domain: ".x.com", path: "/", httpOnly: true, secure: true },
      { name: "ct0", value: c, domain: ".x.com", path: "/", secure: true },
    ];
  return null;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(REAL_UA);
  await page.setViewport({ width: 1280, height: 900 });
  const cookies = loadCookies();
  if (cookies) await page.setCookie(...cookies);

  await page.goto("https://x.com/i/chat", { waitUntil: "domcontentloaded" });
  await wait(9000);

  const stillLocked = /pin|passcode|recovery/i.test(page.url());
  console.log("URL:", page.url(), "| locked:", stillLocked);
  if (stillLocked) {
    console.log("Profile is locked again — unlock didn't persist. Stopping.");
    await browser.close();
    process.exit(0);
  }

  // 1) Conversation list anchors
  const convs = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll('a[href*="/i/chat/"]')
    ) as HTMLAnchorElement[];
    const seen = new Set<string>();
    const out: { href: string; text: string }[] = [];
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text: (a as HTMLElement).innerText.replace(/\n+/g, " | ").slice(0, 80) });
    }
    return out;
  });
  console.log("\n=== CONVERSATION ANCHORS ===");
  console.log(JSON.stringify(convs, null, 2));

  // 2) Open first 1:1 conversation (digits-dash-digits; skip groups "g...")
  const first = convs.find((c) => /\/i\/chat\/\d+-\d+$/.test(c.href));
  if (first) {
    await page.goto("https://x.com" + first.href, { waitUntil: "domcontentloaded" });
    await wait(7000);
    const msgInfo = await page.evaluate(() => {
      const candidates = [
        '[data-testid="messageEntry"]',
        '[data-testid="DmConversation"]',
        '[data-testid="cellInnerDiv"]',
        '[role="row"]',
        '[data-testid="tweetText"]',
        "[data-testid]",
      ];
      const counts: Record<string, number> = {};
      for (const s of candidates) counts[s] = document.querySelectorAll(s).length;
      // Collect the set of data-testid values present (helps find the real one).
      const testids = new Set<string>();
      document.querySelectorAll("[data-testid]").forEach((e) => {
        const t = e.getAttribute("data-testid");
        if (t) testids.add(t);
      });
      // Grab the main scrollable region's inner text as a sanity check.
      const main = document.querySelector('[data-testid="primaryColumn"]') || document.body;
      return {
        url: location.href,
        counts,
        testids: Array.from(testids).slice(0, 60),
        sampleText: (main as HTMLElement).innerText.slice(0, 600),
        sampleHTML: (main as HTMLElement).innerHTML.slice(0, 2500),
      };
    });
    console.log("\n=== MESSAGE DOM ===");
    console.log(JSON.stringify(msgInfo, null, 2));
    await page.screenshot({ path: path.join(DIR, "x-conv.png") });
  }
  await browser.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
