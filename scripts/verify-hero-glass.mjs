// Public marketing UI only. No account APIs or external requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";

const base = process.env.WEBSITE_QA_URL || "http://127.0.0.1:3003";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".local/hero-glass-qa";
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) {
      blocked.push(url.pathname); return request.abort();
    }
    return request.continue();
  });
  const scroll = async progress => {
    await page.$eval("[data-glass-hero]", (node, amount) => window.scrollTo({ top: amount ? node.offsetTop + node.offsetHeight * amount : 0, behavior: "instant" }), progress);
    await new Promise(resolve => setTimeout(resolve, 250));
  };
  const opacity = () => page.$eval("[data-hero-glass]", node => Number(getComputedStyle(node).opacity));
  for (const width of [1440, 390, 320]) {
    await page.setViewport({ width, height: width > 600 ? 1000 : 844 });
    for (const theme of ["dark", "light"]) {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      await page.goto(base + "/landing", { waitUntil: "networkidle2" });
      const dark = await page.$eval('[aria-label="Website appearance: dark mode"]', node => node.getAttribute("aria-checked") === "true");
      if (dark !== (theme === "dark")) await page.click('[aria-label="Website appearance: dark mode"]');
      await scroll(0);
      assert.ok(await opacity() < 0.01, "Hero starts clear");
      await page.screenshot({ path: `${output}/${width}-${theme}-clear.png` });
      await scroll(0.2);
      const halfway = await opacity();
      assert.ok(halfway > 0.2 && halfway < 0.7, `Continuous morph, not a threshold toggle: ${halfway}`);
      await page.screenshot({ path: `${output}/${width}-${theme}-glass.png` });
      await scroll(0.45);
      assert.ok(await opacity() > 0.8, "Glass strengthens with scroll");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.$eval("[data-hero-glass]", node => getComputedStyle(node).pointerEvents), "none");
      await scroll(0);
      assert.ok(await opacity() < 0.01, "Scrolling back restores the hero");
      const cta = await page.$("[data-glass-hero] button");
      await page.keyboard.press("Tab");
      await cta.focus();
      assert.notEqual(await cta.evaluate(node => getComputedStyle(node).outlineStyle), "none");
      await page.keyboard.press("Enter");
      await page.waitForSelector('[aria-labelledby="setup-title"]');
      await page.keyboard.press("Escape");
      await page.waitForSelector('[aria-labelledby="setup-title"]', { hidden: true });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await scroll(0.4);
      assert.equal(await opacity(), 0);
      assert.equal(await page.$eval("[data-hero-surface]", node => getComputedStyle(node).transform), "none");
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  console.log("PASS: continuous reversible hero glass morph, light/dark, desktop/mobile, focus/CTA modal, no overflow, reduced motion, no account requests.");
} finally { await browser.close(); }
