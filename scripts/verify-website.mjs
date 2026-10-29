// Isolated public-site tests. Never connect to a personal workspace or account API.
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";

const base = process.env.WEBSITE_QA_URL || "http://127.0.0.1:3003";
const staticSite = process.env.WEBSITE_STATIC === "1";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".local/website-qa";
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [], blocked = [];
let failReleases = false;
const settle = () => new Promise(resolve => setTimeout(resolve, 350));
page.on("pageerror", error => errors.push(error.message));
await page.setRequestInterception(true);
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) { blocked.push(url.pathname); return request.abort(); }
  if (failReleases && url.pathname === "/changelog.json") return request.respond({ status: 503, body: "Unavailable" });
  return request.continue();
});
async function clickText(text) {
  await page.waitForFunction(text => [...(document.querySelector('[role="dialog"]') || document).querySelectorAll("button")].some(button => button.getClientRects().length && button.textContent.trim().startsWith(text)), {}, text);
  const handle = await page.evaluateHandle(text => [...(document.querySelector('[role="dialog"]') || document).querySelectorAll("button")].find(button => button.getClientRects().length && button.textContent.trim().startsWith(text)), text);
  assert.ok(handle.asElement(), `Missing button: ${text}`); await handle.evaluate(node => node.scrollIntoView({ block: "center", behavior: "instant" })); await handle.click(); await handle.dispose(); await settle();
}
async function click(selector) {
  await page.$eval(selector, node => node.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.click(selector); await settle();
}
async function visit(path = "/") {
  const response = await page.goto(base + path, { waitUntil: "networkidle2" });
  assert.ok([200, 304].includes(response.status()), `${path}: ${response.status()}`); await settle();
}
async function overflow(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label);
}
try {
  await page.setViewport({ width: 1440, height: 1050, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await visit();
  const brandColours = await page.$$eval("[data-brand-platform]", nodes =>
    Object.fromEntries(nodes.map(node => [node.dataset.brandPlatform, getComputedStyle(node).backgroundColor])));
  assert.deepEqual(brandColours, {
    telegram: "rgb(34, 158, 217)", whatsapp: "rgb(37, 211, 102)",
    x: "rgb(15, 20, 25)", discord: "rgb(88, 101, 242)",
  });
  assert.match(await page.title(), /Your people/);
  assert.equal(await page.$eval('link[rel="canonical"]', element => element.href), "https://2manydms.com/");
  const expandedWidth = await page.$eval('nav[aria-label="Main navigation"]', element => element.getBoundingClientRect().width);
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await page.waitForSelector('[data-navbar-compact="true"]');
  assert.ok(await page.$eval('nav[aria-label="Main navigation"]', element => element.getBoundingClientRect().width) < expandedWidth);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForSelector('[data-navbar-compact="false"]');
  await overflow("desktop");
  await page.screenshot({ path: `${output}/desktop-dark.png` });
  await click("#demo-tab-board");
  await page.click('[aria-label="Move Maya Chen to In conversation"]');
  assert.ok(await page.$('[aria-label="Move Maya Chen to Moving forward"]'));
  await click("#demo-tab-flow");
  await clickText("Preview workflow");
  assert.match(await page.$eval("#demo-panel", element => element.innerText), /Preview complete/);
  await click("#demo-tab-assistant");
  await clickText("Who asked me");
  await clickText("Maya Chen · Telegram");
  assert.equal(await page.$eval("#demo-tab-inbox", element => element.getAttribute("aria-selected")), "true");
  await page.type('[aria-label="Try a demo reply"]', "Thanks, I’ll send the details.");
  await page.click('[aria-label="Send demo reply"]');
  assert.match(await page.$eval("#demo-panel", element => element.innerText), /Demo only · not sent/);
  await page.type('[aria-label="Search demo conversations"]', "nothingmatches");
  assert.match(await page.$eval("#demo-panel", element => element.innerText), /No demo conversations match/);
  await clickText("Clear search");
  await page.focus("#demo-tab-inbox"); await page.keyboard.press("ArrowRight"); await settle();
  assert.equal(await page.$eval("#demo-tab-board", element => element.getAttribute("aria-selected")), "true");
  await page.keyboard.press("Home"); await settle();
  for (const id of ["telegram", "whatsapp", "x", "discord"]) { await click(`#connection-${id}`); assert.equal(await page.$eval(`#connection-${id}`, element => element.getAttribute("aria-selected")), "true"); }
  await page.focus("#connection-discord"); await page.keyboard.press("Home");
  assert.equal(await page.$eval("#connection-telegram", element => element.getAttribute("aria-selected")), "true");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Blocked for test"); } } }));
  await clickText("Choose your setup prompt");
  assert.equal(await page.$eval('[role="dialog"]', element => element.contains(document.activeElement)), true);
  await clickText("Copy prompt for Codex");
  assert.equal(await page.$eval('[role="dialog"] details', element => element.open), true);
  assert.match(await page.$eval('[role="dialog"]', element => element.innerText), /Clipboard access is blocked/);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.testCopiedPrompt = text; } } }));
  await clickText("Copy prompt for Codex");
  assert.match(await page.evaluate(() => window.testCopiedPrompt), /Do not publish/);
  assert.match(await page.evaluate(() => window.testCopiedPrompt), /npm run setup:models -- --yes/);
  assert.match(await page.$eval('[role="dialog"]', element => element.innerText), /Copied for Codex/);
  for (const tool of ["Cursor", "Claude Code"]) {
    await clickText(tool); await clickText(`Copy prompt for ${tool}`);
    assert.match(await page.evaluate(() => window.testCopiedPrompt), new RegExp(`I’m using ${tool}`));
  }
  await click('[role="dialog"] input[type="checkbox"]');
  await clickText("Copy prompt for Claude Code");
  assert.match(await page.evaluate(() => window.testCopiedPrompt), /Skip local model downloads/);
  assert.ok(!(await page.evaluate(() => window.testCopiedPrompt)).includes("--yes"));
  await page.keyboard.press("Escape"); await settle();
  assert.equal(await page.$('[role="dialog"]'), null);
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Choose your setup prompt/);
  for (const feature of ["crm", "flows", "search", "network", "ai", "translation"]) assert.ok(await page.$(`[data-feature="${feature}"]`));
  await clickText("Image text only");
  assert.match(await page.$eval('[data-feature="search"]', element => element.innerText), /1 sample match/);
  await page.$eval('[aria-label="Search feature examples"]', element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.click('[aria-label="Search feature examples"]', { clickCount: 3 });
  await page.type('[aria-label="Search feature examples"]', "notinthefixture");
  await clickText("Reset search example");
  await click('[aria-label="Zoom in to example network"]');
  assert.match(await page.$eval('[aria-label="Reset example network zoom"]', element => element.innerText), /125%/);
  await click('[aria-label="Reset example network zoom"]');
  await click('[aria-label="Choose an example person"] button:first-child');
  assert.match(await page.$eval('[data-feature="network"] [role="status"]', element => element.innerText), /Maya Chen · Design circle/);
  await clickText("Translate this example");
  assert.match(await page.$eval('[data-feature="translation"]', element => element.innerText), /I’ll send you the details tomorrow/);
  await clickText("Replay translation");
  await page.select('[aria-label="Translation example language"]', "Spanish");
  assert.match(await page.$eval('[data-feature="translation"]', element => element.innerText), /Perfecto/);
  await click('[aria-label="Onboarding preview steps"] li:nth-child(3) button');
  await clickText("Continue without cloud AI");
  await click('[data-onboarding-preview] details summary');
  assert.match(await page.$eval('[data-onboarding-preview]', element => element.innerText), /npm run setup:models/);
  await clickText("Next step");
  assert.match(await page.$eval('[data-onboarding-preview]', element => element.innerText), /Selected in preview/);
  await clickText("Restart preview");
  for (const theme of ["light", "dark"]) {
    const selector = '[aria-label="Website appearance: dark mode"]';
    if (await page.$eval(selector, element => element.getAttribute("aria-checked")) !== String(theme === "dark")) await click(selector);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("2many-site-theme")), theme);
    await settle();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${output}/desktop-${theme}.png` });
    // Reveal the full page once before capture, without bypassing its animation logic.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise(resolve => setTimeout(resolve, 30)); } });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await settle();
    await page.screenshot({ path: `${output}/full-${theme}.png`, fullPage: true });
    for (const width of [390, 768]) { await page.setViewport({ width, height: 844 }); await overflow(`${theme}-${width}`); }
    await page.setViewport({ width: 390, height: 844 });
    await visit();
    await page.screenshot({ path: `${output}/mobile-${theme}.png` });
    await clickText("Get started");
    await page.waitForSelector('[aria-labelledby="setup-title"]');
    await page.screenshot({ path: `${output}/setup-modal-mobile-${theme}.png` });
    await overflow(`${theme}-setup-modal`);
    await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
    assert.equal(await page.$eval('[role="dialog"]', element => element.contains(document.activeElement)), true);
    await page.keyboard.press("Escape"); await settle();
    await page.click('[aria-label="Open navigation"]'); await settle();
    assert.equal(await page.$eval('[role="dialog"]', element => element.contains(document.activeElement)), true);
    await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
    assert.equal(await page.$eval('[role="dialog"]', element => element.contains(document.activeElement)), true);
    await page.screenshot({ path: `${output}/mobile-menu-${theme}.png` });
    await page.keyboard.press("Escape"); await settle();
    assert.equal(await page.$('[role="dialog"]'), null);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Open navigation");
    await page.click('[aria-label="Open navigation"]'); await settle();
    await page.click('[role="dialog"] a[href="/landing#connections"]'); await settle();
    assert.equal(await page.$('[role="dialog"]'), null);
    await visit();
    await clickText("Maya Chen");
    await page.screenshot({ path: `${output}/mobile-inbox-${theme}.png` });
    await page.click('[aria-label="Back to demo conversations"]');
    for (const tab of ["board", "flow", "assistant", "inbox"]) { await click(`#demo-tab-${tab}`); await overflow(`${theme}-mobile-${tab}`); }
    for (const feature of ["crm", "search", "network", "translation"]) {
      await page.$eval(`[data-feature="${feature}"]`, element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await settle(); await overflow(`${theme}-mobile-${feature}`);
      await page.screenshot({ path: `${output}/mobile-${feature}-${theme}.png` });
    }
    await page.$eval("#onboarding", element => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await settle(); await overflow(`${theme}-mobile-onboarding`);
    await page.setViewport({ width: 1440, height: 1050 });
  }
  await visit("/privacy");
  assert.match(await page.$eval("main", element => element.innerText), /OpenRouter/);
  await page.screenshot({ path: `${output}/privacy.png` });
  failReleases = true;
  await visit("/changelog"); await page.waitForSelector('[role="alert"]');
  failReleases = false;
  await clickText("Retry loading updates"); await page.waitForSelector("article time");
  assert.match(await page.$eval("main", element => element.innerText), /v0\.6\.2/);
  await page.screenshot({ path: `${output}/updates.png` });
  await page.setViewport({ width: 390, height: 844 });
  await overflow("mobile-changelog");
  await visit("/privacy"); await overflow("mobile-privacy");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await visit();
  const switchSelector = '[aria-label="Website appearance: dark mode"]';
  await page.focus(switchSelector); await page.keyboard.press("Space");
  await new Promise(resolve => setTimeout(resolve, 600));
  const themeChecked = await page.$eval(switchSelector, element => element.getAttribute("aria-checked") === "true");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), themeChecked);
  await page.$eval('[data-feature="translation"]', element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForSelector('[data-translation-phase="translating"]');
  await page.screenshot({ path: `${output}/translation-working.png` });
  await page.waitForSelector('[data-translation-phase="translated"]');
  await new Promise(resolve => setTimeout(resolve, 900));
  await page.screenshot({ path: `${output}/translation-result.png` });
  await page.$eval('header[data-navbar-compact]', element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await page.click('[aria-label="Open navigation"]'); await settle();
  await clickText("Get started");
  await page.waitForSelector('[aria-labelledby="setup-title"]');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.$$eval('[role="dialog"]', elements => elements.length), 1);
  await page.keyboard.press("Escape"); await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.$('[role="dialog"]'), null);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Open navigation");
  await page.setViewport({ width: 1440, height: 1050 });
  await clickText("Get started"); await new Promise(resolve => setTimeout(resolve, 600));
  await page.screenshot({ path: `${output}/setup-modal-desktop.png` });
  await page.keyboard.press("Escape"); await new Promise(resolve => setTimeout(resolve, 600));
  for (const path of ["/api/accounts", "/api/accounts.json", "/api/assistant"]) {
    assert.equal((await fetch(base + path, { redirect: "manual" })).status, 404, path);
  }
  const privatePage = await fetch(base + "/board", { redirect: "manual" });
  if (staticSite) assert.equal(privatePage.status, 404);
  else { assert.equal(privatePage.status, 307); assert.equal(new URL(privatePage.headers.get("location")).pathname, "/"); }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log("PASS: public routes, API isolation, bento search/network/translation, onboarding preview, collapsing nav, demo interactions, keyboard, clipboard failure/success, mobile focus, both themes, overflow, privacy and changelog retry. No external or account requests.");
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
