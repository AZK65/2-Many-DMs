// Synthetic public demo only. Never read or contact a real messaging account.
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";

const base = process.env.WEBSITE_QA_URL || "http://127.0.0.1:3006";
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
const settle = () => new Promise(resolve => setTimeout(resolve, 350));
async function click(selector) {
  await page.$eval(selector, element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.click(selector); await settle();
}
async function capture(name) {
  await page.$eval("[data-demo-frame]", element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await settle(); await (await page.$("[data-demo-frame]")).screenshot({ path: `${output}/${name}.png` });
}
async function query(text) {
  await click('[aria-label="Search demo conversations"]');
  await page.$eval('[aria-label="Search demo conversations"]', element => element.select());
  await page.keyboard.press("Backspace"); await page.type('[aria-label="Search demo conversations"]', text); await settle();
}
try {
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  for (const theme of ["dark", "light"]) {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(base, { waitUntil: "networkidle2" });
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    await settle(); await capture(`product-demo-${theme}`);
    const copy = await page.evaluate(() => document.body.textContent);
    assert.doesNotMatch(copy, /private (?:GitHub )?repository|repository (?:is |is currently |remains )private|access is currently required/i);
    assert.equal(await page.$$eval("[data-demo-chat]", nodes => nodes.length), 5);
    await query("priya@sample.example");
    assert.equal(await page.$$eval("[data-demo-chat]", nodes => nodes.length), 1);
    assert.ok(await page.$('[data-demo-chat="2"]'));
    await query("");
    await click('[aria-label="Filter demo conversations"] button:nth-child(3)');
    assert.equal(await page.$$eval("[data-demo-chat]", nodes => nodes.length), 1);
    await click('[data-demo-chat="4"]');
    assert.match(await page.$eval('[data-demo-messages]', node => node.textContent), /Maya Chen/);
    assert.match(await page.$eval('[data-demo-messages]', node => node.textContent), /Priya Nair/);
    await click('[aria-label="Show demo contact details"]');
    assert.match(await page.$eval('[aria-label="Demo contact details"]', node => node.textContent), /Group info/);
    await click('[aria-label="Close demo contact details"]');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Show demo contact details");
    await click('[aria-label="Show demo contact details"]');
    await page.keyboard.press("Escape"); await settle();
    assert.equal(await page.$('[aria-label="Demo contact details"]'), null);
    await capture(`product-demo-group-${theme}`);
    await click('[aria-label="Filter demo conversations"] button:first-child');
    await click('[aria-label="Collapse demo sidebar"]');
    assert.equal(await page.$eval('[aria-label="Demo conversations"]', node => node.getBoundingClientRect().width), 80);
    await click('[data-demo-chat="2"]');
    assert.match(await page.$eval('[aria-label="Demo message thread"] header', node => node.textContent), /Priya Nair/);
    await capture(`product-demo-compact-${theme}`);
    await click('[aria-label="Search demo inbox"]');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Search demo conversations");
    await click('[data-demo-chat="3"]');
    assert.match(await page.$eval('[aria-label="Demo message thread"]', node => node.textContent), /read only/);
    assert.equal(await page.$('[aria-label="Try a demo reply"]'), null);
    await click('[data-demo-chat="0"]');
    const collapsed = await page.$eval('[aria-label="Try a demo reply"]', node => node.getBoundingClientRect().height);
    await page.type('[aria-label="Try a demo reply"]', 'Thanks Maya. Here is the plan for the project. '.repeat(10));
    assert.ok(await page.$eval('[aria-label="Try a demo reply"]', node => node.getBoundingClientRect().height) > collapsed);
    await click('[aria-label="Send demo reply"]');
    assert.equal(await page.$eval('[aria-label="Try a demo reply"]', node => node.value), "");
    assert.equal(await page.$eval('[aria-label="Try a demo reply"]', node => node.getBoundingClientRect().height), collapsed);
    assert.match(await page.$eval('[data-demo-messages]', node => node.textContent), /Demo only · not sent/);
    await click('[aria-label="Add a smile to demo reply"]');
    assert.equal(await page.$eval('[aria-label="Try a demo reply"]', node => node.value), "😊");
    await click('#demo-tab-board'); await click('#demo-tab-inbox');
    assert.equal(await page.$eval('[aria-label="Try a demo reply"]', node => node.value), "😊");
    for (const width of [768, 1024]) {
      await page.setViewport({ width, height: 1000 }); await settle();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.$eval('[aria-label="Demo message thread"]', node => node.scrollWidth <= node.clientWidth), true);
    }
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(base, { waitUntil: "networkidle2" });
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    await click('#demo-tab-assistant');
    await click('#demo-panel > div:last-child button');
    await click('#demo-panel [role="status"] button');
    assert.equal(await page.$eval('[aria-label="Demo message thread"]', node => !!node.getClientRects().length), true);
    await click('[aria-label="Back to demo conversations"]');
    await click('[data-demo-chat="0"]');
    await capture(`product-demo-phone-${theme}`);
    await click('[aria-label="Show demo contact details"]');
    assert.equal(await page.$eval('[aria-label="Demo contact details"]', node => node.getBoundingClientRect().right <= innerWidth), true);
    await click('[aria-label="Close demo contact details"]');
  }
  assert.deepEqual(errors, []);
  console.log("PASS: public repo copy; both themes; group speakers, email search, filters, compact sidebar, details, auto-growing reply, draft retention, read-only Discord, mobile AI navigation. No external or account requests.");
} catch (error) {
  await page.screenshot({ path: `${output}/product-demo-failure.png` }).catch(() => {}); throw error;
} finally { await browser.close(); }
