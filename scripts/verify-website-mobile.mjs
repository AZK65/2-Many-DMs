// Public website only: touch layouts, no personal workspace or remote requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";

const base = process.env.WEBSITE_QA_URL || "http://127.0.0.1:3003";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".local/website-qa";
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.setRequestInterception(true);
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) {
    errors.push(`Unexpected request: ${url.pathname}`); return request.abort();
  }
  return request.continue();
});
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
async function tap(selector) {
  await page.$eval(selector, element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await settle(); await page.tap(selector); await settle();
}
async function fits(selector) {
  assert.equal(await page.$eval(selector, element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
  }), true, `${selector} must fit without hidden clipping`);
}
try {
  await page.setViewport({ width: 320, height: 740, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  for (const theme of ["dark", "light"]) {
    await page.goto(base, { waitUntil: "networkidle2" });
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    for (const [width, height] of [[320, 740], [375, 812], [430, 932], [667, 375]]) {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true }); await settle();
      await fits('nav[aria-label="Main navigation"]');
      await fits('[aria-label="Demo conversations"]');
      await fits('[aria-label="Explore product features"]');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewport({ width: 320, height: 740, isMobile: true, hasTouch: true });
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" })); await settle();
    await page.screenshot({ path: `${output}/touch-hero-${theme}.png` });
    await tap('[data-demo-chat="0"]');
    await fits('[aria-label="Try a demo reply"]');
    await fits('[aria-label="Send demo reply"]');
    await tap('[aria-label="Back to demo conversations"]');
    await tap("#faq-question-1");
    assert.equal(await page.$eval("#faq-question-1", element => element.getAttribute("aria-expanded")), "true");
    await fits("#faq-answer-1");
    await page.screenshot({ path: `${output}/touch-faq-${theme}.png` });
    await tap("#faq-question-1");
    for (let index = 0; index < 4; index++) {
      await tap(`[aria-label="Onboarding preview steps"] li:nth-child(${index + 1}) button`);
      await fits("[data-onboarding-preview]");
    }
    await tap('[aria-label="Open navigation"]');
    await fits('[role="dialog"]');
    await tap('[aria-label="Close navigation"]');
    await tap("#setup .marketing-primary");
    await fits('[role="dialog"]');
    await page.screenshot({ path: `${output}/touch-setup-${theme}.png` });
    await tap('[aria-label="Close setup guide"]');
  }
  assert.deepEqual(errors, []);
  console.log("PASS: 320/375/430px phones and landscape, both themes, touch navigation, FAQ, chat demo, onboarding and setup. No private or external requests.");
} catch (error) {
  await page.screenshot({ path: `${output}/touch-failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
