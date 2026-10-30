import assert from "node:assert/strict";
import test from "node:test";
import puppeteer from "puppeteer";
import { readXMessageDom } from "./x-message-dom";
import { richerXMessageText } from "./x-message-text";

test("real X text-wrapper structure excludes both timestamp copies without trimming authored clocks", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    // Synthetic content with the observed native DOM structure, including the
    // opacity-zero spacer that innerText still reads. No account or network.
    const samples = ["Hello", "Meet at 5:30 PM", "5:30 PM", "First line\nSecond line", "no", "https://example.invalid/path", "💀"];
    await page.setContent('<div data-testid="xchatEmbedRoute"></div>');
    await page.evaluate((texts) => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')!.attachShadow({ mode: "open" });
      root.innerHTML = '<div data-testid="dm-message-list" style="width:800px"></div>';
      for (const [index, text] of texts.entries()) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const row = document.createElement("div");
        row.dataset.testid = `message-${id}`;
        row.innerHTML = `<div data-side="${index % 2 ? "end" : "start"}"><div data-testid="message-text-${id}" class="relative"><div class="relative inline-flex flex-wrap"><span class="text-body"><span dir="auto" class="whitespace-pre-wrap" style="white-space:pre-wrap"></span><span aria-hidden="true" style="opacity:0"><div><span>11:45 AM</span></div></span></span><div class="absolute bottom-0"><div><span>11:45 AM</span><svg aria-hidden="true"></svg></div></div></div></div></div>`;
        row.querySelector('[dir="auto"]')!.textContent = text;
        root.querySelector('[data-testid="dm-message-list"]')!.append(row);
      }
    }, samples);
    const rows = await page.evaluate(readXMessageDom);
    assert.deepEqual(rows.map(row => row.text), samples);
    assert.ok(rows.every(row => row.timeText === "11:45 AM"));
    assert.deepEqual(rows.map(row => row.direction), samples.map((_, i) => i % 2 ? "out" : "in"));
    for (const text of samples) {
      assert.equal(richerXMessageText(`${text}\n11:45 AM\n11:45 AM`, text), text);
    }
    assert.equal(richerXMessageText("Meet at 5:30 PM", "Meet at"), "Meet at 5:30 PM");
    assert.equal(richerXMessageText("First line\n11:45 AM", "First line"), "First line\n11:45 AM");
    assert.equal(richerXMessageText("First line\n11:45 AM\n11:46 AM", "First line"), "First line\n11:45 AM\n11:46 AM");
  } finally { await browser.close(); }
});
