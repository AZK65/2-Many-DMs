// Public website only: test placement, keyboard behavior and both themes.
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
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(base, { waitUntil: "networkidle2" });
    if (width >= 640) {
      assert.equal(await page.$eval(trigger, node => {
        const previous = node.parentElement.parentElement.previousElementSibling;
        return previous.textContent.includes("Get started") && previous.getBoundingClientRect().right < node.getBoundingClientRect().left;
      }), true, "Appearance follows Get started");
    }
    for (const theme of ["light", "dark"]) {
      await page.focus(trigger);
      await page.keyboard.press(theme === "light" ? "ArrowDown" : "ArrowUp");
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitemradio");
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), theme === "dark" ? "Dark" : "Light");
      await page.screenshot({ path: `${output}/${width}-${theme}-menu.png` });
      assert.equal(await page.$eval('[role="menu"]', node => {
        const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
      }), true, "Menu stays inside viewport");
      await page.keyboard.press("Enter"); await pause();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
      assert.equal(await page.evaluate(() => localStorage.getItem("2many-site-theme")), theme);
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Website appearance");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${output}/${width}-${theme}.png` });
    }
    await page.reload({ waitUntil: "networkidle2" });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
    await page.click(trigger); await page.keyboard.press("Escape"); await pause();
    assert.equal(await page.$eval(trigger, node => node.getAttribute("aria-expanded")), "false");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Website appearance");
    await page.click(trigger); await page.click("h1"); await pause();
    assert.equal(await page.$('[role="menu"]'), null);
  }
  // Escape closes only the nested appearance menu, not mobile navigation.
  await page.click('[aria-label="Open navigation"]');
  await page.waitForSelector('[role="dialog"]');
  await page.click('[aria-label="Mobile menu appearance"]');
  await page.keyboard.press("Escape"); await pause();
  assert.ok(await page.$('[role="dialog"]'));
  assert.equal(await page.$('[role="menu"]'), null);
  await page.keyboard.press("Escape"); await pause();
  assert.equal(await page.$('[role="dialog"]'), null);
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await page.click(trigger); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  await pause();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
  await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
  await page.waitForSelector('[data-navbar-compact="true"]');
  await page.click(trigger); await pause();
  await page.screenshot({ path: `${output}/compact-menu.png` });
  assert.equal(await page.$eval('[role="menu"]', node => node.getBoundingClientRect().top > 0), true);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log("PASS: appearance placement, both themes, persistence, keyboard, focus return, dismissal, nested mobile menu, compact navbar, 320–1440px, no account requests.");
} finally { await browser.close(); }
