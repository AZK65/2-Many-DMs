// Browser fixtures only: all API and off-origin requests are intercepted.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const base = process.env.ASSISTANT_TEST_URL || "http://127.0.0.1:3003";
const settingsOnly = process.env.TEST_SETTINGS_ONLY === "1";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Local test server required");
const output = new URL("../.local/assistant-qa/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const state = { configured: false, failSave: false, failAsk: false, saves: 0, asks: [], pending: false };
const now = new Date().toISOString();
const chats = ["Taylor", "Casey"].map((name, index) => ({
  id: `fixture-chat-${index}`, platform: "telegram", externalId: `${index}`, unread: 0, hasUnreadMention: false, lastMessageAt: now, lastMessage: "Let’s follow up tomorrow.",
  pinned: false, hidden: false, archived: false, inboxCategory: "general", status: "open", intent: "normal", followUpAt: null, snoozedUntil: null, lastOpenedAt: null,
  priority: false, todo: false, todoNote: null, todoCompleted: false, todoAddedAt: null, translationEnabled: false, translationLanguageCode: null, translationLanguageName: null,
  lastDirection: "in", folderIds: [], account: { id: "fixture-account", label: "Demo account", driver: null, status: "connected" }, isGroup: false, topicOf: null,
  contact: { id: `fixture-contact-${index}`, name, handle: `@${name.toLowerCase()}`, company: null, email: null, phone: null, notes: null, stage: null, avatarUrl: null, tags: [] },
}));
const source = { ref: "S1", messageId: "fixture-message", conversationId: chats[1].id, name: "Casey", platform: "telegram", speaker: "Casey", sentAt: now, snippet: "Email me at demo@sample.example" };
await page.setRequestInterception(true);
page.on("request", async request => {
  const url = new URL(request.url());
  if (url.origin !== base) return request.abort();
  if (!url.pathname.startsWith("/api/")) return request.continue();
  let body = {}, status = 200;
  const p = url.pathname;
  if (["/api/accounts", "/api/tags", "/api/folders", "/api/snippets", "/api/contacts", "/api/keyword-alerts", "/api/todos"].includes(p)) body = [];
  if (p === "/api/connections") body = { workerRunning: true, platforms: { accounts: [{ accountId: "fixture-account", state: "ready" }] } };
  if (p === "/api/conversations") body = chats;
  if (/\/conversations\/[^/]+$/.test(p)) body = chats.find(chat => p.endsWith(chat.id)) || chats[0];
  if (p.endsWith("/messages")) body = { messages: [{ id: "fixture-message", conversationId: p.split("/")[3], body: source.snippet, direction: "in", createdAt: now, mediaType: null, mediaUrl: null, senderContact: null, reactions: [] }], hasMore: false };
  if (p.endsWith("/members")) body = { members: [] };
  if (p === "/api/assistant/settings") {
    if (request.method() === "POST") {
      state.saves++;
      const posted = JSON.parse(request.postData()); assert.equal(posted.consent, true);
      if (state.failSave) { status = 401; body = { error: "OpenRouter rejected this test key. Try another." }; }
      else state.configured = true;
    }
    if (request.method() === "DELETE") state.configured = false;
    if (status === 200) body = { configured: state.configured, model: "openai/gpt-4.1-mini" };
  }
  if (p === "/api/assistant") {
    state.asks.push(JSON.parse(request.postData()));
    if (state.pending) await new Promise(resolve => setTimeout(resolve, 1200));
    if (state.failAsk) { status = 402; body = { error: "Your OpenRouter credits are exhausted." }; }
    else body = { answer: "Casey shared demo@sample.example [S1].", sources: [source] };
  }
  await request.respond({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
});
async function waitText(value) { await page.waitForFunction(value => document.body.innerText.includes(value), { timeout: 30000 }, value); }
async function click(label) {
  await page.waitForFunction(label => [...document.querySelectorAll("button")].some(node => node.textContent.trim() === label && !node.disabled), {}, label);
  await page.evaluate(label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label && !node.disabled).click(), label);
}
async function closeDialog() { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[role="dialog"]')); }
async function shot(name) { await new Promise(resolve => setTimeout(resolve, 500)); await page.screenshot({ path: new URL(`${name}.png`, output).pathname }); }
async function keyField(value) {
  const field = await page.$('input[type="password"]'); await field.click({ clickCount: 3 }); await field.type(value);
}
try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => { localStorage.setItem("onboarded", "1"); localStorage.setItem("theme", "light"); });
  if (!settingsOnly) {
    await page.goto(base + "/welcome", { waitUntil: "networkidle2" });
    await page.evaluate(() => sessionStorage.setItem("2manydms-setup-step", "2")); await page.reload({ waitUntil: "networkidle2" });
    await waitText("OpenRouter API key");
    await page.click("details summary");
    assert.ok((await page.$eval("body", node => node.innerText)).includes("npm run setup:models"));
    assert.ok((await page.$eval("body", node => node.innerText)).includes("does not need an OpenRouter key"));
    await shot("onboarding-light");
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await shot("local-translation-onboarding-dark");
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await click("Skip for now"); await waitText("Your workspace is ready"); assert.equal(state.saves, 0);
    await click("Open my inbox");
  } else await page.goto(base, { waitUntil: "networkidle2" });
  await page.waitForSelector('[aria-label="Open settings"]');
  const assistantLabel = settingsOnly ? "Open Sales Agent" : "Open AI assistant";
  await page.waitForSelector(`[aria-label="${assistantLabel}"]`);
  const position = await page.evaluate(label => {
    const s = document.querySelector('[aria-label="Open settings"]').getBoundingClientRect();
    const a = document.querySelector(`[aria-label="${label}"]`).getBoundingClientRect();
    return { settingsY: s.y, aiY: a.y, x: s.x };
  }, assistantLabel);
  assert.ok(position.settingsY < position.aiY && position.x < 64, "settings is above assistant in left rail");
  await page.click('[aria-label="Open settings"]'); await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press("Tab"); assert.ok(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
  await closeDialog(); assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Open settings");
  if (!settingsOnly) {
    await page.click('[aria-label="Open AI assistant"]'); await waitText("Set up AI assistant"); await click("Set up AI assistant");
    await waitText("OpenRouter API key");
    const fakeKey = ["sk", "or", "fixture", "x".repeat(24)].join("-");
    await keyField(fakeKey);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll("button")].find(node => node.textContent === "Connect AI").disabled));
    await page.click('input[type="checkbox"]'); state.failSave = true; await click("Connect AI"); await waitText("rejected this test key");
    state.failSave = false; await click("Connect AI"); await waitText("OpenRouter connected");
    assert.equal(await page.$eval('input[type="password"]', node => node.value), "");
    assert.ok(!(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(fakeKey));
    await closeDialog(); await page.click('[aria-label="Open AI assistant"]'); await waitText("What would you like to find?");
    await page.select("#assistant-scope", "chat"); await page.type('[aria-label="Ask your chats"]', "Find an email"); await page.click('[aria-label="Ask assistant"]'); await waitText("Casey shared");
    assert.equal(state.asks.at(-1).conversationId, chats[0].id); await shot("assistant-light");
    await page.evaluate(() => [...document.querySelectorAll("button")].find(node => node.textContent.includes("[S1] Casey")).click());
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]')); await waitText("Casey");
    await page.click('[aria-label="Open AI assistant"]'); await waitText("What would you like to find?");
    await page.select("#assistant-scope", "all"); state.failAsk = true;
    await page.type('[aria-label="Ask your chats"]', "Find emails this week"); await page.click('[aria-label="Ask assistant"]'); await waitText("credits are exhausted");
    assert.equal(await page.$eval('[aria-label="Ask your chats"]', node => node.value), "Find emails this week");
    assert.equal(state.asks.at(-1).conversationId, undefined); state.failAsk = false;
    await page.click('[aria-label="Ask assistant"]'); await waitText("Casey shared");
    await page.setViewport({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.classList.add("dark"));
    await shot("assistant-dark-narrow"); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.press("Tab"); assert.ok(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
    await click("AI settings"); await waitText("Replace API key"); await shot("settings-dark-narrow");
    await click("Remove saved key"); await waitText("Key removed"); assert.equal(state.configured, false);
    await closeDialog(); await page.click('[aria-label="Open AI assistant"]'); await waitText("Set up AI assistant"); await closeDialog();
  }
  await page.goto(base + "/board", { waitUntil: "networkidle2" }); await page.click('[aria-label="Open settings"]'); await page.waitForSelector('[role="dialog"]'); await closeDialog();
  assert.deepEqual(errors, []);
  console.log("PASS: rail order, Settings across pages, keyboard/focus, optional onboarding, key consent/save/error/removal, scoped questions, sources, retry, and narrow/dark layouts. Fixtures only.");
} finally { await browser.close(); }
