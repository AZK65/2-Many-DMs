import assert from "node:assert/strict";
import test from "node:test";
import puppeteer, { type Browser } from "puppeteer";
import { inspectXChatGate, waitForXChatGate } from "./x-chat-gate";
import { tryUnlock } from "./x-passcode";
import { XAdapter } from "./adapters/x";

// Isolated synthetic pages: every network request is intercepted. No sessions,
// accounts, real passcodes, messages, or production data are used.
async function fixture(browser: Browser, mode: "delayed" | "reject" | "success" | "blank" | "empty" | "login", single = false) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.resourceType() !== "document") { void request.abort(); return; }
    void request.respond({ contentType: "text/html", body: `<!doctype html><div id="host"></div><script>
      window.submissions=0; window.enters=0;
      const root=document.querySelector('#host').attachShadow({mode:'open'});
      const nested=document.createElement('div');root.append(nested);const chat=nested.attachShadow({mode:'open'});
      function inbox(){history.replaceState({},'', '/i/chat');chat.innerHTML='<div data-testid="dm-conversation-scroller"></div>';}
      function gate(){history.replaceState({},'', '/i/chat/pin/recovery?from=%2Fi%2Fchat');chat.innerHTML='<style>input{width:50px;height:35px}</style><p>Enter passcode</p>'+'<input inputmode="numeric" type="password">'.repeat(${single ? 1 : 4});
        const inputs=[...chat.querySelectorAll('input')];
        const submit=()=>{window.submissions++;const value=inputs.map(i=>i.value).join('');
          if(${JSON.stringify(mode)}==='blank'){history.replaceState({},'', '/i/chat');chat.innerHTML='<p>Loading…</p>';return;}
          if(value==='1234'){setTimeout(inbox,300);return;}
          const error=document.createElement('p');error.role='alert';error.textContent='Incorrect passcode';chat.append(error);
        };
        inputs.forEach(input=>{input.oninput=()=>{chat.querySelector('[role=alert]')?.remove();if(inputs.length>1 && inputs.every(i=>i.value.length===1))submit();};input.onkeydown=e=>{if(e.key==='Enter'){window.enters++;submit();}};});
      }
      if(${JSON.stringify(mode)}==='empty')inbox();else if(${JSON.stringify(mode)}==='delayed')setTimeout(gate,500);else if(${JSON.stringify(mode)}!=='login')gate();
    </script>` });
  });
  await page.goto(mode === "login" ? "https://x.com/login" : "https://x.com/i/chat");
  return page;
}

test("X gate waits for delayed redirects and recognizes an empty nested inbox", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const delayed = await fixture(browser, "delayed");
    assert.equal(await inspectXChatGate(delayed), "loading");
    assert.equal(await waitForXChatGate(delayed, 2000), "locked");
    assert.equal(await inspectXChatGate(await fixture(browser, "empty")), "inbox");
    assert.equal(await inspectXChatGate(await fixture(browser, "login")), "login");
  } finally { await browser.close(); }
});

test("X checks the actual inbox, submits once, and never retries a rejected code", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await fixture(browser, "reject");
    const options = { accountId: "fixture-rejected", passcode: "0000", explicit: true, timeoutMs: 1500 };
    assert.equal(await tryUnlock(page, options), "rejected");
    assert.equal(await tryUnlock(page, options), "rejected");
    assert.deepEqual(await page.evaluate(() => [Reflect.get(window, "submissions"), Reflect.get(window, "enters")]), [1, 0]);
    assert.equal(await tryUnlock(page, { ...options, passcode: "1234" }), "unlocked");
    assert.equal(await inspectXChatGate(page), "inbox");
    assert.equal(await tryUnlock(page, options), "not-locked");
    const single = await fixture(browser, "success", true);
    assert.equal(await tryUnlock(single, { accountId: "fixture-single", passcode: "1234", timeoutMs: 1500 }), "unlocked");
    assert.equal(await single.evaluate(() => Reflect.get(window, "submissions")), 1);
  } finally { await browser.close(); }
});

test("X loading is not unlock success, and unknown attempts are not repeated in background", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const options = { accountId: "fixture-unknown", passcode: "1234", timeoutMs: 500 };
    assert.equal(await tryUnlock(await fixture(browser, "blank"), options), "error");
    const second = await fixture(browser, "success");
    assert.equal(await tryUnlock(second, options), "error");
    assert.equal(await second.evaluate(() => Reflect.get(window, "submissions")), 0);
    assert.equal(await tryUnlock(second, { ...options, explicit: true, timeoutMs: 1500 }), "unlocked");
  } finally { await browser.close(); }
});

test("manual unlock preserves cooldowns, rejects overlapping attempts, resumes loops, and reports expired login", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  // Construct only the transport state, avoiding the real adapter's disk/store setup.
  const adapter = Object.assign(Object.create(XAdapter.prototype), {
    browser, page: await fixture(browser, "success"), lifecycleVersion: 1,
    state: "disconnected", rateLimitUntil: Date.now() + 10_000,
    inboxRetryAt: Date.now() + 20_000, scheduleAutomaticRepair() {},
  }) as { unlockChat: XAdapter["unlockChat"]; page: import("puppeteer").Page; state: string;
    inboxRetryAt: number; rateLimitUntil: number; timer?: ReturnType<typeof setInterval>; liveTimer?: ReturnType<typeof setInterval> };
  try {
    const originalRetry = adapter.inboxRetryAt;
    await assert.rejects(adapter.unlockChat("1234"), /rate limiting/);
    assert.equal(adapter.inboxRetryAt, originalRetry);
    adapter.rateLimitUntil = 0;
    const first = adapter.unlockChat("1234");
    await assert.rejects(adapter.unlockChat("1234"), /busy/);
    assert.equal((await first).state, "unlocked");
    assert.equal(adapter.state, "ready");
    assert.ok(adapter.timer && adapter.liveTimer);
    assert.equal(adapter.inboxRetryAt, 0);
    adapter.page = await fixture(browser, "login");
    assert.equal((await adapter.unlockChat("1234")).state, "login-required");
    assert.equal(adapter.timer, undefined);
    assert.equal(adapter.liveTimer, undefined);
  } finally {
    clearInterval(adapter.timer); clearInterval(adapter.liveTimer);
    await browser.close();
  }
});
