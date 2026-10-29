// Run against a local dev server. All API requests are intercepted with fixtures:
// this test never signs in, sends a code, links a device, or touches real accounts.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";
import QRCode from "qrcode";

const base = process.env.ONBOARDING_TEST_URL || "http://127.0.0.1:3002";
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(base).hostname)) throw new Error("Use a local test server");
const output = new URL("../.local/onboarding-qa/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const qr = await QRCode.toDataURL("UI TEST ONLY — NOT A LOGIN CODE");
const state = { live: [], attempts: 0, discord: { state: "idle", canLaunch: true }, pair: null, pairNumber: 0 };
await page.setRequestInterception(true);
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== base || !url.pathname.startsWith("/api/")) return request.continue();
  let body = {}, status = 200;
  const p = url.pathname, method = request.method();
  if (p === "/api/accounts") body = method === "POST" ? { id: "fixture-wa", platform: "whatsapp", driver: "baileys", label: "Test phone", status: "pending" } : [];
  if (p === "/api/connections") body = { workerRunning: true, platforms: { accounts: state.live } };
  if (p === "/api/telegram/login/start") body = method === "GET" ? { configured: false, storageReady: true } : { loginId: "test-login", expiresAt: Date.now() + 300000, retryAfter: 60, delivery: "app" };
  if (p === "/api/telegram/login/verify") {
    state.attempts++;
    if (state.attempts === 1) { status = 400; body = { error: "That code was not accepted. Enter the latest login code from Telegram." }; }
    else if (state.attempts === 2) body = { needsPassword: true };
    else body = { accountId: "fixture-tg" };
  }
  if (p === "/api/accounts/pair") body = method === "POST" ? { code: "ABC123TEST" + ++state.pairNumber, expiresAt: Date.now() + 600000 } : state.pair || { accountId: null };
  if (p === "/api/accounts/fixture-wa/qr") body = { status: { state: "qr", qr } };
  if (p === "/api/accounts/discord/search") body = state.discord;
  return request.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
});
const text = () => page.$eval("body", node => node.innerText);
async function click(label) {
  await page.waitForFunction(label => [...document.querySelectorAll("button")].some(node => node.textContent.trim() === label && !node.disabled), {}, label);
  await page.evaluate(label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label && !node.disabled).click(), label);
}
async function fill(label, value) {
  const id = await page.evaluate(label => [...document.querySelectorAll("label")].find(node => node.textContent.trim() === label)?.htmlFor, label);
  assert.ok(id, `label ${label}`);
  const input = await page.$(`[id="${id}"]`);
  await input.click({ clickCount: 3 }); await input.type(value);
}
async function waitText(value) { await page.waitForFunction(v => document.body.innerText.includes(v), { timeout: 15000 }, value); }
async function open(platform) {
  const btn = await page.evaluateHandle(platform => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Connect" && node.parentElement.textContent.includes(platform)), platform);
  await btn.click(); await btn.dispose();
  await page.waitForSelector('[role="dialog"]');
}
async function shot(name) { await new Promise(resolve => setTimeout(resolve, 400)); await page.screenshot({ path: new URL(name + ".png", output).pathname }); }
try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base + "/welcome", { waitUntil: "networkidle2" });
  await page.evaluate(() => { localStorage.setItem("theme", "light"); sessionStorage.setItem("omni-setup-step", "1"); sessionStorage.setItem("2manydms-setup-step", "1"); });
  await page.reload({ waitUntil: "networkidle2" });
  for (const platform of ["Telegram", "WhatsApp", "Discord", "X (Twitter)"]) assert.ok((await text()).includes(platform));
  await open("Telegram"); await waitText("Create your Telegram app once");
  await shot("telegram-light");
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await shot("telegram-dark-narrow");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await fill("API ID", "12345678"); await fill("API hash", "a".repeat(32)); await click("Continue to sign in");
  await fill("Telegram phone number", "2025550147");
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("button")].find(n => n.textContent === "Send login code").disabled));
  await fill("Telegram phone number", "+12025550147"); await click("Send login code"); await waitText("Login code");
  await fill("Login code", "12345"); await click("Verify and connect"); await waitText("That code was not accepted");
  await click("Verify and connect"); await waitText("Two-step verification password");
  await fill("Two-step verification password", "fixture-only"); await click("Verify and connect"); await waitText("Account saved. Connecting");
  assert.ok(!(await text()).includes("Connected and ready"));
  state.live = [{ accountId: "fixture-tg", state: "ready" }]; await waitText("Connected and ready");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.setViewport({ width: 1280, height: 900 });
  await open("WhatsApp"); await click("Show my QR code");
  state.live.push({ accountId: "fixture-wa", state: "qr", qr }); await waitText("Linked devices");
  await page.waitForSelector('img[alt="Scan to connect Test phone"]'); await shot("whatsapp-dark");
  await click("Generate new QR code"); await waitText("Generate new QR code");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await open("X (Twitter)"); await waitText("One small browser connector"); await shot("x-dark");
  await click("Connector installed. Continue"); await waitText("ABC123TEST");
  state.pair = { expired: true }; await waitText("Code expired");
  state.pair = { accountId: "fixture-x" }; await click("New pairing code"); await waitText("Account saved. Connecting");
  state.live.push({ accountId: "fixture-x", state: "disconnected", detail: "X Chat is locked" }); await waitText("X Chat passcode");
  await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await open("Discord"); await waitText("Open Discord sign-in"); await shot("discord-dark");
  await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
  state.discord = { state: "error", canLaunch: false, reason: "A headless server cannot open this login window." }; await waitText("A headless server");
  state.discord = { state: "connected", canLaunch: true, accountId: "fixture-discord" };
  state.live.push({ accountId: "fixture-discord", state: "ready" }); await waitText("Connected and ready");
  assert.deepEqual(errors, []);
  console.log("PASS: guided setup, validation, code retry, 2FA, QR refresh, pairing expiry, X unlock, Discord status, keyboard, dark/light/narrow layouts. No real account mutations.");
} finally { await browser.close(); }
