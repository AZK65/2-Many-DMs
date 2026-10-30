// Public website only: direct one-tap theme switching, never a popup.
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";

const base = process.env.WEBSITE_QA_URL || "http://127.0.0.1:3006";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".local/header-appearance-qa";
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ channel: "chrome", headless: true });
const pause = () => new Promise(resolve => setTimeout(resolve, 300));
try {
  const page = await browser.newPage();
  const errors = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== base || url.pathname.startsWith("/api/")) { blocked.push(url.pathname); return request.abort(); }
    return request.continue();
  });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const trigger = '[aria-label="Website appearance"]';
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  async function assertTheme(dark, selector = trigger) {
    await pause();
    assert.equal(await isDark(), dark);
    assert.equal(await page.evaluate(() => localStorage.getItem("2many-site-theme")), dark ? "dark" : "light");
    assert.equal(await page.$eval(selector, node => node.getAttribute("aria-pressed")), String(dark));
    assert.equal(await page.$eval(selector, node => node.getAttribute("title")), `Switch to ${dark ? "light" : "dark"} mode`);
    assert.equal(await page.$('[role="menu"]'), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewport({ width, height: 900, hasTouch: width < 640 });
    await page.goto(base, { waitUntil: "networkidle2" });
    assert.equal(await page.$eval(trigger, node => node.textContent.trim()), "");
    assert.equal(await page.$eval(trigger, node => node.hasAttribute("aria-haspopup")), false);
    assert.equal(await page.$eval(trigger, node => { const rect = node.getBoundingClientRect(); return rect.width === rect.height; }), true);
    if (width >= 640) assert.equal(await page.$eval(trigger, node => {
      const previous = node.parentElement.previousElementSibling;
      return previous.textContent.includes("Get started") && previous.getBoundingClientRect().right < node.getBoundingClientRect().left;
    }), true, "Appearance follows Get started");
    const initial = await isDark();
    for (const dark of [!initial, initial]) {
      if (width < 640) await page.tap(trigger); else await page.click(trigger);
      await assertTheme(dark);
      await page.screenshot({ path: `${output}/${width}-${dark ? "dark" : "light"}.png` });
    }
    for (const key of ["Enter", "Space"]) {
      const before = await isDark();
      await page.focus(trigger); await page.keyboard.press(key);
      await assertTheme(!before);
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Website appearance");
    }
    const saved = await isDark();
    await page.reload({ waitUntil: "networkidle2" });
    assert.equal(await isDark(), saved);
  }
  await page.click('[aria-label="Open navigation"]');
  await page.waitForSelector('[role="dialog"]');
  const beforeMobile = await isDark();
  await page.click('[aria-label="Mobile menu appearance"]');
  await assertTheme(!beforeMobile, '[aria-label="Mobile menu appearance"]');
  assert.ok(await page.$('[role="dialog"]'), "Theme switching keeps mobile navigation open");
  await page.keyboard.press("Escape"); await pause();
  assert.equal(await page.$('[role="dialog"]'), null);
  await page.setViewport({ width: 1440, height: 900, hasTouch: false });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
  await page.waitForSelector('[data-navbar-compact="true"]');
  const beforeCompact = await isDark();
  await page.click(trigger); await assertTheme(!beforeCompact);
  await page.screenshot({ path: `${output}/compact-direct-switch.png` });
  await page.$eval('[aria-label="Footer appearance"]', node => node.scrollIntoView({ block: "center", behavior: "instant" }));
  const beforeFooter = await isDark();
  await page.click('[aria-label="Footer appearance"]');
  await assertTheme(!beforeFooter, '[aria-label="Footer appearance"]');
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log("PASS: one-click/tap theme switch, no menu, keyboard, persistence, icon-only, footer/mobile/compact nav, 320–1440px, reduced motion, no account requests.");
} finally { await browser.close(); }
