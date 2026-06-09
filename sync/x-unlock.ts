import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { REAL_UA } from "./x-browser";
import { cleanChromeLocks } from "./chrome-locks";

const DIR = path.join(process.cwd(), ".x_auth");
const PROFILE = path.join(process.cwd(), ".x_profile");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadCookies(): any[] | null {
  const file = path.join(DIR, "cookies.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const token = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (token && ct0)
    return [
      { name: "auth_token", value: token, domain: ".x.com", path: "/", httpOnly: true, secure: true },
      { name: "ct0", value: ct0, domain: ".x.com", path: "/", secure: true },
    ];
  return null;
}

async function main() {
  cleanChromeLocks(PROFILE);
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setUserAgent(REAL_UA);
  const cookies = loadCookies();
  if (cookies) await page.setCookie(...cookies);

  await page.goto("https://x.com/i/chat", { waitUntil: "domcontentloaded" });

  console.log(
    "\nA browser window opened on X messages.\n" +
      "👉 Type your XChat passcode in the window yourself (don't let me guess it).\n" +
      "Waiting for the chats to unlock…\n"
  );

  let ok = false;
  for (let i = 0; i < 600; i++) {
    const url = page.url();
    if (!/pin|passcode|recovery/i.test(url)) {
      // Confirm we're actually on the chat surface, not some other page.
      await wait(2000);
      ok = !/pin|passcode|recovery/i.test(page.url());
      if (ok) break;
    }
    await wait(1000);
  }

  if (ok) {
    console.log(
      "\n✅ Unlocked. Encryption keys are saved in .x_profile — the worker will reuse them.\n" +
        "You can close this window. Then run `npm run sync`."
    );
  } else {
    console.log("\nTimed out waiting for unlock. Nothing changed.");
  }
  await wait(2500);
  await browser.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
