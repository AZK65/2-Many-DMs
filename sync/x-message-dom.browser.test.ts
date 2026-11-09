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

    await page.evaluate(() => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')!.shadowRoot!;
      const row = document.createElement('div');
      row.dataset.testid = 'message-11111111-1111-4111-8111-111111111111';
      row.innerHTML = '<div data-side="start"><button aria-label="Download"><img src="data:image/svg+xml,%3Csvg/%3E"></button><span>Annual Report.pdf</span><span id="file-time">2:35 PM</span></div>';
      root.querySelector('[data-testid="dm-message-list"]')!.append(row);
      const blobIcon = document.createElement('div');
      blobIcon.dataset.testid = 'message-22222222-2222-4222-8222-222222222222';
      blobIcon.innerHTML = '<div data-side="start"><img src="blob:https://x.com/file-card-glyph"><button aria-label="Download"></button><span id="blob-file-time">2:36 PM</span></div>';
      root.querySelector('[data-testid="dm-message-list"]')!.append(blobIcon);
    });
    const withFile = await page.evaluate(readXMessageDom);
    const file = withFile.find(row => row.id === '11111111-1111-4111-8111-111111111111')!;
    assert.deepEqual(file.attachments, [{ type: 'file', source: null, name: 'Annual Report.pdf', nativeDownload: true }]);
    const blobFile = withFile.find(row => row.id === '22222222-2222-4222-8222-222222222222')!;
    assert.equal(blobFile.attachments[0].type, 'image');
    assert.equal(blobFile.attachments[0].nativeDownload, true, 'blob SVG file glyph keeps the native document-download signal');

    await page.evaluate(() => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')!.shadowRoot!;
      const row = document.createElement('div');
      row.dataset.testid = 'message-33333333-3333-4333-8333-333333333333';
      row.innerHTML = '<div data-side="start"><div data-testid="message-text-33333333-3333-4333-8333-333333333333"><span dir="auto">Sent a post</span></div><a data-testid="tweet-card" href="https://twitter.com/finityx/status/2012584288298901546?s=20"><img src="https://pbs.twimg.com/media/example.jpg"></a><span id="post-time">1:45 PM</span></div>';
      root.querySelector('[data-testid="dm-message-list"]')!.append(row);
    });
    const withPost = await page.evaluate(readXMessageDom);
    const post = withPost.find(row => row.id === '33333333-3333-4333-8333-333333333333')!;
    assert.equal(post.text, 'Sent a post\nhttps://x.com/finityx/status/2012584288298901546');
    assert.deepEqual(post.attachments, [], 'link-card artwork is not a message attachment');
  } finally { await browser.close(); }
});
