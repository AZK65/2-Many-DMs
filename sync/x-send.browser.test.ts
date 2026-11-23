import assert from "node:assert/strict";
import test from "node:test";
import puppeteer, { type Browser } from "puppeteer";
import { XAdapter } from "./adapters/x";
import { focusXComposer } from "./x-composer";

// Synthetic native DOM only. All traffic is intercepted; these tests cannot
// access an account or send to X.
async function fixture(browser: Browser, delayMs = 0) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.resourceType() !== "document") { void request.abort(); return; }
    void request.respond({ contentType: "text/html", body: `<!doctype html><div data-testid="xchatEmbedRoute"></div><script>
      window.sends=0;
      const root=document.querySelector('[data-testid="xchatEmbedRoute"]').attachShadow({mode:'open'});
      root.innerHTML='<div data-testid="dm-message-list"></div>';
      function mount(){
        const box=document.createElement('div');
        box.innerHTML='<textarea data-testid="dm-composer-textarea"></textarea><button data-testid="dm-composer-send-button">Send</button>';
        root.append(box);
        box.querySelector('button').onclick=()=>{window.sends++;const text=box.querySelector('textarea').value;window.sentText=text;
          const row=document.createElement('div');row.dataset.testid='message-11111111-1111-4111-8111-111111111111';
          row.innerHTML='<div data-side="end"><div data-testid="message-text-11111111-1111-4111-8111-111111111111"><span dir="auto"></span></div></div>';
          row.querySelector('span').textContent=text;root.querySelector('[data-testid="dm-message-list"]').append(row);box.querySelector('textarea').value='';
        };
      }
      setTimeout(mount,${delayMs});
    </script>` });
  });
  await page.goto("https://x.com/i/chat/111-222");
  return page;
}

test("composer can hydrate past the old 750ms retry limit, including a covered input", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await fixture(browser, 1100);
    await page.evaluate(() => {
      const overlay=document.createElement("div"); overlay.style.cssText="position:fixed;inset:0;z-index:999"; document.body.append(overlay);
    });
    await focusXComposer(page, "111-222", 3000);
    assert.equal(await page.evaluate(() => Reflect.get(window, "sends")), 0);
    await page.evaluate(() => history.replaceState({}, "", "/i/chat/333-444"));
    await assert.rejects(focusXComposer(page, "111-222"), /changed conversations/);
    await page.evaluate(() => history.replaceState({}, "", "/i/chat/pin/recovery"));
    await assert.rejects(focusXComposer(page, "111-222"), /locked/);
    assert.equal(await page.evaluate(() => Reflect.get(window, "sends")), 0);
  } finally { await browser.close(); }
});

test("send survives the composer being removed on activation and clicks Send exactly once", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await fixture(browser);
    await page.waitForSelector('pierce/textarea');
    const front = page.bringToFront.bind(page);
    page.bringToFront = async () => {
      await front();
      await page.evaluate(() => {
        const root=document.querySelector('[data-testid="xchatEmbedRoute"]')!.shadowRoot!;
        const input=root.querySelector('textarea')!; const parent=input.parentElement!;
        input.remove(); setTimeout(() => parent.prepend(input), 1100);
      });
    };
    const adapter = Object.assign(Object.create(XAdapter.prototype), { assertNotCoolingDown() {}, nativeMessageTimes: new Map() }) as any;
    const text = "https://example.invalid/start\nPlease check this link.";
    const receipt = await adapter.sendFromOpenConversation(page, "111-222", text);
    assert.equal(receipt.messageExternalId, "x:11111111-1111-4111-8111-111111111111");
    assert.deepEqual(await page.evaluate(() => [Reflect.get(window, "sends"), Reflect.get(window, "sentText")]), [1, text]);
  } finally { await browser.close(); }
});

test("a locked send page fails before Send instead of waiting through repeated reloads", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await fixture(browser);
    await page.evaluate(() => history.replaceState({}, "", "/i/chat/pin/recovery"));
    // Simulate navigation finishing at the PIN gate.
    page.goto = async () => null;
    let gates = 0;
    const adapter = Object.assign(Object.create(XAdapter.prototype), {
      assertNotCoolingDown() {}, unlockBackgroundPage: async () => { gates++; return false; },
    }) as any;
    await assert.rejects(adapter.openGeneralConversation(page, "111-222"), /locked/);
    assert.equal(gates, 1);
    assert.equal(await page.evaluate(() => Reflect.get(window, "sends")), 0);
  } finally { await browser.close(); }
});

test("a browser error after mouse dispatch stays uncertain and never repeats Send", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await fixture(browser);
    const click = page.click.bind(page);
    page.click = async (selector, options) => {
      await click(selector, options);
      throw new Error("Transport response lost after dispatch");
    };
    const adapter = Object.assign(Object.create(XAdapter.prototype), { assertNotCoolingDown() {}, nativeMessageTimes: new Map() }) as any;
    await assert.rejects(adapter.sendFromOpenConversation(page, "111-222", "Fixture message"), /sending message failed/);
    assert.equal(await page.evaluate(() => Reflect.get(window, "sends")), 1);
  } finally { await browser.close(); }
});
