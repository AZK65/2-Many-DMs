// Only the static marketing demo is captured. No live inbox, database or login is used.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const base = new URL(process.env.DEMO_PREVIEW_URL || "http://127.0.0.1:3003/landing");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "Use an isolated local marketing server");
const browser = await puppeteer.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.setRequestInterception(true);
page.on("request", request => {
  const url = new URL(request.url());
  const allowed = url.origin === base.origin && request.method() === "GET" &&
    (url.pathname === "/landing" || url.pathname === "/changelog.json" || url.pathname.startsWith("/_next/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/favicon"));
  return allowed ? request.continue() : request.abort();
});
try {
  await page.setViewport({ width: 1440, height: 1050, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(base.origin + "/landing", { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-demo-frame]");
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every(img => img.complete));
  // Static marketing animations settle before capture; no connected account data is loaded.
  await new Promise(resolve => setTimeout(resolve, 1400));
  const text = await page.$eval("body", node => node.innerText);
  assert.ok(text.includes("Fictional demo"));
  assert.ok(text.includes("Maya Chen"));
  const issueLinks = await page.$$('a[href="https://github.com/AZK65/2-Many-DMs/issues"]');
  assert.ok(issueLinks.length >= 3);
  assert.equal(await page.$('a[href^="https://t.me/"]'), null);
  await issueLinks[1].focus();
  assert.ok(await page.evaluate(() => document.activeElement.textContent.includes("GitHub issues")));
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: new URL("../docs/hero.png", import.meta.url).pathname });
  const frame = await page.$("[data-demo-frame]");
  for (const [label, file] of [["Inbox", "inbox"], ["CRM", "board"], ["Flows", "automations"]]) {
    const button = await frame.evaluateHandle((node, label) => [...node.querySelectorAll("button")].find(button => button.textContent.trim() === label), label);
    await button.click();
    await page.waitForFunction(label => [...document.querySelectorAll('[data-demo-frame] button[aria-pressed="true"]')].some(button => button.textContent.trim() === label), {}, label);
    await frame.screenshot({ path: new URL(`../docs/${file}.png`, import.meta.url).pathname });
    await button.dispose();
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme} narrow overflow`);
    assert.equal(await page.$eval('[data-demo-frame]', node => node.scrollWidth > node.clientWidth), false, `${theme} demo overflow`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: fictional previews captured; support links, keyboard focus, light/dark and narrow layout checked. External requests and account APIs blocked.");
} finally {
  await browser.close();
}
