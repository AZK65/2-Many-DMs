// Isolated inbox fixtures. Every API and off-origin request is intercepted.
import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";
const base = process.env.DELIVERY_TEST_URL || "http://127.0.0.1:3004";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await puppeteer.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const now = new Date().toISOString();
const chat = {
  id: "fixture-x", platform: "x", externalId: "fixture", unread: 0, hasUnreadMention: false, lastMessageAt: now, lastMessage: "Hello",
  pinned: false, hidden: false, archived: false, inboxCategory: "general", status: "open", intent: "normal", followUpAt: null, snoozedUntil: null, lastOpenedAt: null,
  priority: false, todo: false, todoNote: null, todoCompleted: false, todoAddedAt: null, translationEnabled: false, translationLanguageCode: null, translationLanguageName: null,
  lastDirection: "in", folderIds: [], account: { id: "fixture-account", label: "Demo account", driver: "browser", status: "connected" }, isGroup: false, topicOf: null,
  contact: { id: "fixture-contact", name: "Taylor Demo", handle: "@demo", company: null, email: null, phone: null, notes: null, stage: null, avatarUrl: null, tags: [] },
};
const incoming = { id: "fixture-in", body: "Hello", direction: "in", createdAt: now, mediaType: null, mediaUrl: null, senderContactId: null, senderTags: [], reactions: [] };
const state = { mode: "race", posted: [], receipts: new Map(), getIds: [], pendingResponse: null, history: [incoming] };
const response = (req, body, status = 200) => req.respond({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
await page.setRequestInterception(true);
page.on("request", async req => {
  const url = new URL(req.url());
  if (url.origin !== base) return req.abort();
  if (!url.pathname.startsWith("/api/")) return req.continue();
  const p = url.pathname;
  let body = {};
  if (["/api/accounts", "/api/tags", "/api/folders", "/api/snippets", "/api/contacts", "/api/keyword-alerts", "/api/todos"].includes(p)) body = [];
  if (p === "/api/connections") body = { workerRunning: true, platforms: { x: { platform: "x", state: "ready" }, accounts: [{ accountId: "fixture-account", platform: "x", state: "ready" }] } };
  if (p === "/api/conversations") body = [chat];
  if (/\/conversations\/[^/]+$/.test(p)) body = chat;
  if (p.endsWith("/members")) body = { members: [] };
  if (p.endsWith("/messages")) {
    if (req.method() === "POST") {
      const posted = JSON.parse(req.postData());
      state.posted.push(posted);
      const pending = { ...incoming, id: posted.clientMessageId, body: posted.body, direction: "out", deliveryStatus: "pending", externalKey: null, deliveryError: null };
      if (state.mode === "race") {
        state.receipts.set(pending.id, { ...pending, deliveryStatus: "sent", externalKey: "x:native-fixture" });
        state.pendingResponse = () => response(req, { message: pending }, 202);
        return;
      }
      if (state.mode === "timeout") {
        state.receipts.set(pending.id, { ...pending, deliveryStatus: "sent", externalKey: "x:native-after-timeout" });
        await new Promise(resolve => setTimeout(resolve, 1200));
        return req.abort();
      }
      state.receipts.set(pending.id, pending);
      return response(req, { message: pending }, 202);
    }
    const ids = (url.searchParams.get("deliveryIds") || "").split(",").filter(Boolean);
    state.getIds.push(...ids);
    body = { messages: state.history.slice(-40), deliveries: ids.flatMap(id => state.receipts.has(id) ? [state.receipts.get(id)] : []), hasMore: false };
  }
  return response(req, body);
});
async function waitForSent(id) {
  await page.waitForFunction(id => {
    const node = document.querySelector('[data-message-id="' + id + '"]');
    return node && !/Sending|Queued|Unconfirmed|Delivery unknown|Not sent/i.test(node.innerText);
  }, {}, id);
}
async function send(text) {
  console.log("Fixture:", text);
  await page.type('textarea[placeholder="Write a message…"]', text);
  await page.click('[aria-label="Send message"]');
  await page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
  const deadline = Date.now() + 10000;
  while (!state.posted.some(item => item.body === text) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(state.posted.some(item => item.body === text), JSON.stringify({ posted: state.posted, draft: await page.$eval("textarea", node => node.value) }));
  return state.posted.find(item => item.body === text).clientMessageId;
}
try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => { localStorage.setItem("onboarded", "1"); localStorage.setItem("theme", "light"); localStorage.setItem("omnicrm-autocorrect-enabled-v1", "false"); });
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-conversation-id="fixture-x"]');
  await page.click('[data-conversation-id="fixture-x"]');
  await page.waitForSelector('textarea[placeholder="Write a message…"]');
  const first = await send("Delayed acknowledgement fixture");
  await waitForSent(first);
  assert.ok(state.getIds.includes(first));
  await state.pendingResponse();
  await new Promise(resolve => setTimeout(resolve, 500));
  await waitForSent(first);

  state.mode = "busy";
  const second = await send("Busy chat fixture");
  state.history = Array.from({ length: 60 }, (_, i) => ({ ...incoming, id: "newer-" + i, body: "Newer fixture " + i }));
  await page.waitForFunction(id => document.querySelector('[data-message-id="' + id + '"]').innerText.includes("Sending"), {}, second);
  state.receipts.set(second, { ...state.receipts.get(second), deliveryStatus: "sent", externalKey: "x:native-busy" });
  await waitForSent(second);
  assert.ok(state.getIds.includes(second));

  state.mode = "timeout";
  const third = await send("Interrupted response fixture");
  await waitForSent(third);
  assert.equal(await page.evaluate(() => document.body.innerText.includes("The request ended before delivery was confirmed")), false, "Late receipt clears the uncertainty warning");
  assert.equal(state.posted.length, 3, "No automatic retries");
  assert.equal(new Set(state.posted.map(post => post.clientMessageId)).size, 3);

  state.mode = "busy";
  const fourth = await send("Uncertain send fixture");
  state.receipts.set(fourth, { ...state.receipts.get(fourth), deliveryStatus: "unconfirmed", deliveryError: "Check X before retrying." });
  await page.waitForFunction(id => /Delivery unknown/.test(document.querySelector('[data-message-id="' + id + '"]').innerText), {}, fourth);
  assert.equal(state.posted.length, 4, "Uncertain sends are not retried");
  fs.mkdirSync(".local/delivery-qa", { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 1100));
  await page.screenshot({ path: ".local/delivery-qa/light.png" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.setViewport({ width: 900, height: 800 });
  await new Promise(resolve => setTimeout(resolve, 1100));
  await page.screenshot({ path: ".local/delivery-qa/dark.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: delayed 202 cannot restore Queued; exact delivery lookup beyond latest 40; aborted responses still reconcile; uncertainty stays visible; no duplicate sends. All APIs mocked.");
} finally { await browser.close(); }
