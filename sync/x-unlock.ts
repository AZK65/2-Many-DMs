import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { REAL_UA } from "./x-browser";
import { cleanChromeLocks } from "./chrome-locks";
import { isLocked, tryUnlock } from "./x-passcode";

const DIR = path.join(process.cwd(), ".x_auth");
// Must match adapters/x.ts, which resolves the profile under DATA_DIR. In Docker
// (DATA_DIR=/data, WORKDIR=/app) a cwd-relative path would write the unlocked
// profile somewhere the worker never reads — and never persist past a restart.
const PROFILE = path.join(process.env.DATA_DIR || process.cwd(), ".x_profile");
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

  // A headless box (self-hosted server, no X display) has no window for you to
  // type into — enter X_PASSCODE programmatically instead. Force it with
  // `npm run x:unlock -- --headless`.
  const headless =
    process.argv.includes("--headless") ||
    (process.platform === "linux" && !process.env.DISPLAY);

  if (headless && !(process.env.X_PASSCODE || "").trim()) {
    console.error(
      "No display available and X_PASSCODE isn't set.\n" +
        "Set X_PASSCODE in .env — that's how XChat unlocks on a headless server —\n" +
        "or run this on a machine with a screen."
    );
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: headless ? { width: 1280, height: 900 } : null,
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setUserAgent(REAL_UA);
  const cookies = loadCookies();
  if (cookies) await page.setCookie(...cookies);

  await page.goto("https://x.com/i/chat", { waitUntil: "domcontentloaded" });

  if (headless) {
    await wait(9000); // let XChat finish booting before we look for the gate
    const result = await tryUnlock(page);
    const done = result === "unlocked" || result === "not-locked";
    console.log(
      done
        ? "\n✅ Unlocked. Encryption keys are saved in .x_profile — the worker will reuse them.\n" +
            "Now run `npm run sync`."
        : `\n❌ Couldn't unlock (${result}).`
    );
    await browser.close();
    process.exit(done ? 0 : 1);
  }

  console.log(
    "\nA browser window opened on X messages.\n" +
      "👉 Type your XChat passcode in the window yourself (don't let me guess it).\n" +
      "Waiting for the chats to unlock…\n"
  );

  let ok = false;
  for (let i = 0; i < 600; i++) {
    if (!(await isLocked(page))) {
      // Confirm we're actually on the chat surface, not some other page.
      await wait(2000);
      ok = !(await isLocked(page));
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
