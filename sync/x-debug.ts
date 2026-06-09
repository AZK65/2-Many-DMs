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
  const token = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (token && ct0)
    return [
      { name: "auth_token", value: token, domain: ".x.com", path: "/", httpOnly: true, secure: true },
      { name: "ct0", value: ct0, domain: ".x.com", path: "/", secure: true },
    ];
  return null;
}

async function dump(page: any, label: string) {
  const info = await page.evaluate(() => {
    const sels = [
      '[data-testid="conversation"]',
      '[data-testid="cellInnerDiv"]',
      'a[href^="/messages/"]',
      'a[href*="/i/chat"]',
      '[data-testid="messageEntry"]',
      '[data-testid="DmConversation"]',
      '[role="row"]',
      "input",
    ];
    const counts: Record<string, number> = {};
    for (const s of sels) counts[s] = document.querySelectorAll(s).length;
    const inputs = Array.from(document.querySelectorAll("input")).map((i: any) => ({
      type: i.type,
      inputmode: i.getAttribute("inputmode"),
      maxlength: i.maxLength,
      testid: i.getAttribute("data-testid"),
      aria: i.getAttribute("aria-label"),
      autocomplete: i.autocomplete,
      placeholder: i.placeholder,
    }));
    const buttons = Array.from(document.querySelectorAll('button,[role="button"]'))
      .slice(0, 18)
      .map((b: any) => ({
        text: (b.innerText || "").slice(0, 24),
        testid: b.getAttribute("data-testid"),
      }));
    return {
      url: location.href,
      counts,
      inputs,
      buttons,
      bodyText: (document.body.innerText || "").slice(0, 350),
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(info, null, 2));
  return info;
}

async function main() {
  const cookies = loadCookies();
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(REAL_UA);
  await page.setViewport({ width: 1280, height: 900 });
  if (cookies) await page.setCookie(...cookies);

  await page.goto("https://x.com/i/chat", { waitUntil: "domcontentloaded" });
  await wait(9000);
  const pre = await dump(page, "BEFORE PASSCODE");
  await page.screenshot({ path: path.join(DIR, "x-pre.png") });

  const pass = process.env.X_PASSCODE || "";
  const onPasscode = /pin|passcode/i.test(pre.url) || /passcode/i.test(pre.bodyText);
  if (pass && onPasscode) {
    const readBack = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("input"))
          .map((i: any) => i.value)
          .join("")
      );
    const clearAll = async () => {
      const inputs = await page.$$("input");
      for (const inp of inputs) {
        await inp.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
      }
    };
    const enterPerBox = async () => {
      const inputs = await page.$$("input");
      for (let i = 0; i < pass.length && i < inputs.length; i++) {
        await inputs[i].click();
        await page.keyboard.type(pass[i], { delay: 90 });
      }
    };
    const enterSingleFocus = async () => {
      const inputs = await page.$$("input");
      if (inputs[0]) {
        await inputs[0].click();
        await page.keyboard.type(pass, { delay: 120 });
      }
    };

    await clearAll();
    await enterPerBox();
    await wait(700);
    void readBack;
    void enterSingleFocus;
    // Visual confirmation of the filled boxes (input.value is masked).
    await page.screenshot({ path: path.join(DIR, "x-entry.png") });
    console.log("[unlock] typed digits; saved .x_auth/x-entry.png — submitting ONE attempt...");
    await page.keyboard.press("Enter");
    await wait(7000);
    await dump(page, "AFTER PASSCODE");
    await page.screenshot({ path: path.join(DIR, "x-post.png") });
  }

  console.log("\nSaved screenshots to .x_auth/x-pre.png" + (pass ? " and x-post.png" : ""));
  await browser.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
