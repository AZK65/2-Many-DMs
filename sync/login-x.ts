import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { REAL_UA } from "./x-browser";

const DIR = path.join(process.cwd(), ".x_auth");
const FILE = path.join(DIR, "cookies.json");

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    // Prefer the user's real Chrome if installed — looks far less automated
    // than bundled Chromium. Falls back to Chromium if unavailable.
    channel: (process.env.X_CHROME_CHANNEL as any) || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setUserAgent(REAL_UA);
  await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });

  console.log(
    "\nA browser window opened. Log in to X (handle 2FA / checks as normal).\n" +
      "Waiting for login to complete… (up to 10 minutes)\n"
  );

  let ok = false;
  for (let i = 0; i < 600; i++) {
    const cookies = await page.cookies("https://x.com");
    const hasAuth = cookies.some((c) => c.name === "auth_token");
    const hasCsrf = cookies.some((c) => c.name === "ct0");
    if (hasAuth && hasCsrf) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!ok) {
    console.error("Timed out waiting for login. Nothing saved.");
    await browser.close();
    process.exit(1);
  }

  const cookies = await page.cookies("https://x.com");
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cookies, null, 2));
  console.log(`\n✅ Saved X session to ${FILE}. You can close the window.`);
  await browser.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
