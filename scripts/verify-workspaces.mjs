// Disposable, synthetic runtimes only. Never connects to a real platform.
// OMNI_NEXT_DIST_DIR=.next-workspaces-release node --import tsx scripts/verify-workspaces.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { parse } from "dotenv";
import puppeteer from "puppeteer";
import { copyWorkspaceApplication, cleanWorkspaceEnvironment } from "../src/lib/workspace-runtime.ts";

const exec = promisify(execFile);
const root = process.cwd();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "omni-workspaces-qa-"));
const output = path.join(root, ".local/workspaces-qa");
await fs.mkdir(output, { recursive: true });
const base = "http://127.0.0.1:3012";
const workspaceIds = [];
let server, browser, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 45000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await fn().catch(() => false)) return; await sleep(300); } throw new Error("Timed out waiting for workspace runtime."); }
async function api(url, method = "GET", value) {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(110000), ...(value ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) } : {}) });
  return { status: response.status, value: await response.json() };
}
async function client(directory) { const require = createRequire(path.join(directory, "package.json")); const { PrismaClient } = require("@prisma/client"); return new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, directory === fixture ? "test.db" : "workspace.db")}` } } }); }
async function seed(directory, name) {
  const db = await client(directory);
  try {
    const user = await db.user.upsert({ where: { email: "you@omni-crm.local" }, create: { id: "fixture-user", email: "you@omni-crm.local" }, update: {} });
    await db.account.create({ data: { id: `${name}-account`, userId: user.id, platform: "telegram", label: name, status: "disconnected" } });
    await db.contact.create({ data: { id: `${name}-contact`, name: `${name} Client`, handle: name, email: `${name}@sample.example` } });
    await db.conversation.create({ data: { id: `${name}-chat`, contactId: `${name}-contact`, accountId: `${name}-account`, platform: "telegram", externalId: name } });
    await db.message.create({ data: { id: `${name}-message`, conversationId: `${name}-chat`, direction: "in", body: `${name}@sample.example` } });
  } finally { await db.$disconnect(); }
}
try {
  await copyWorkspaceApplication(fixture);
  const environment = { NODE_ENV: "production", DATABASE_URL: `file:${path.join(fixture, "test.db")}`, APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"), SYNC_CONTROL_URL: "http://127.0.0.1:27998", TELEGRAM_API_ID: "123456", TELEGRAM_API_HASH: "a".repeat(32), TELEGRAM_ENABLED: "0", X_ENABLED: "0", WHATSAPP_ENABLED: "0", DISCORD_ENABLED: "0", OPENROUTER_API_KEY: "fixture-parent-private", DOTENV_CONFIG_PATH: path.join(fixture, ".env"), OMNI_NEXT_DIST_DIR: ".next" };
  await fs.writeFile(path.join(fixture, ".env"), Object.entries(environment).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n"), { mode: 0o600 });
  await fs.writeFile(path.join(fixture, "test.db"), "");
  await fs.mkdir(path.join(fixture, "public/media"), { recursive: true });
  await fs.writeFile(path.join(fixture, "public/media/private-parent.txt"), "PRIVATE PARENT FIXTURE");
  await fs.mkdir(path.join(fixture, ".x_auth"));
  await fs.writeFile(path.join(fixture, ".x_auth/cookies.json"), "[]");
  await exec(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.join(fixture, "prisma/schema.prisma")], { cwd: fixture, env: { ...cleanWorkspaceEnvironment(), ...environment } });
  await seed(fixture, "parent");
  const log = await fs.open(path.join(fixture, "parent.log"), "a");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3012"], { cwd: fixture, env: { ...cleanWorkspaceEnvironment(), ...environment }, stdio: ["ignore", log.fd, log.fd] });
  await log.close();
  await waitFor(async () => (await api(`${base}/api/workspaces/identity`)).status === 200);
  const requestId = randomUUID(); workspaceIds.push(requestId);
  const [first, retry] = await Promise.all([api(`${base}/api/workspaces`, "POST", { requestId, name: "Studio QA" }), api(`${base}/api/workspaces`, "POST", { requestId, name: "Studio QA" })]);
  assert.equal(first.status, 200, JSON.stringify(first.value)); assert.equal(retry.status, 200, JSON.stringify(retry.value));
  assert.equal(first.value.workspace.id, retry.value.workspace.id);
  const a = new URL(first.value.url).origin;
  const secondId = randomUUID(); workspaceIds.push(secondId);
  const second = await api(`${base}/api/workspaces`, "POST", { requestId: secondId, name: "Personal QA" });
  assert.equal(second.status, 200, JSON.stringify(second.value));
  const b = new URL(second.value.url).origin;
  assert.notEqual(a, b);
  const dirs = workspaceIds.map(id => path.join(fixture, ".local/workspaces", id));
  const envs = await Promise.all(dirs.map(async dir => parse(await fs.readFile(path.join(dir, ".env")))));
  assert.notEqual(envs[0].APP_ENCRYPTION_KEY, envs[1].APP_ENCRYPTION_KEY);
  for (let i = 0; i < dirs.length; i++) {
    assert.equal(envs[i].TELEGRAM_API_ID, undefined); assert.equal(envs[i].OPENROUTER_API_KEY, undefined);
    assert.equal(await fs.stat(path.join(dirs[i], ".x_auth/cookies.json")).then(() => true).catch(() => false), false);
    assert.equal(await fs.stat(path.join(dirs[i], "public/media/private-parent.txt")).then(() => true).catch(() => false), false);
    const child = i ? b : a;
    assert.deepEqual((await api(`${child}/api/accounts`)).value, []);
    assert.deepEqual((await api(`${child}/api/conversations`)).value, []);
    assert.deepEqual((await api(`${child}/api/telegram/login/start`)).value, { configured: false, storageReady: true });
    assert.equal((await fetch(`${child}/api/accounts/x/extension`)).status, 200);
    assert.equal((await fetch(`${child}/media/private-parent.txt`)).status, 404);
    const check = await exec(process.execPath, ["-e", "new (require('@prisma/client').PrismaClient)(); console.log(JSON.stringify({tg:process.env.TELEGRAM_API_ID||null,ai:process.env.OPENROUTER_API_KEY||null}));"], { cwd: dirs[i], env: cleanWorkspaceEnvironment() });
    assert.deepEqual(JSON.parse(check.stdout.trim()), { tg: null, ai: null });
  }
  await seed(dirs[0], "studio"); await seed(dirs[1], "personal");
  for (const [url, label] of [[base, "parent"], [a, "studio"], [b, "personal"]]) {
    assert.deepEqual((await api(`${url}/api/accounts`)).value.map(row => row.id), [`${label}-account`]);
    assert.deepEqual((await api(`${url}/api/conversations`)).value.map(row => row.id), [`${label}-chat`]);
    const search = await api(`${url}/api/messages/search?q=parent%40sample.example`);
    if (label !== "parent") assert.equal(JSON.stringify(search.value).includes("parent-message"), false);
  }
  assert.equal((await api(`${b}/api/contacts/studio-contact/relations/candidates?conversationId=studio-chat`)).status, 404);
  assert.equal((await api(`${b}/api/contacts/studio-contact/relations`, "POST", { targetConversationId: "studio-chat" })).status, 404);
  const pair = await api(`${a}/api/accounts/pair`, "POST");
  assert.equal(pair.status, 200);
  assert.equal((await api(`${b}/api/accounts/pair?code=${encodeURIComponent(pair.value.code)}`)).value.expired, true);
  const forbidden = await fetch(`${base}/api/workspaces`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example", "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify({ name: "Bad", requestId: randomUUID() }) });
  assert.equal(forbidden.status, 403);
  assert.equal((await api(`${base}/api/workspaces`, "POST", { requestId: randomUUID(), name: "Studio QA" })).status, 400);
  assert.equal((await api(`${base}/api/workspaces`)).value.workspaces.length, 3);
  const healthA = await (await fetch(`${envs[0].SYNC_CONTROL_URL}/health`)).json();
  const healthB = await (await fetch(`${envs[1].SYNC_CONTROL_URL}/health`)).json();
  assert.notEqual(healthA.pid, healthB.pid);
  await api(`${a}/api/worker/restart`, "POST");
  await waitFor(async () => { const r = await (await fetch(`${envs[0].SYNC_CONTROL_URL}/health`)).json(); return r.workspaceId === requestId && r.pid !== healthA.pid; });
  assert.equal((await (await fetch(`${envs[1].SYNC_CONTROL_URL}/health`)).json()).pid, healthB.pid);
  browser = await puppeteer.launch({ channel: "chrome", headless: true });
  page = await browser.newPage(); const errors = [];
  let failCreation = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", req => {
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || (url.origin !== base && !(Number(url.port) >= 27800 && Number(url.port) < 28000))) return req.abort();
    if (failCreation && url.pathname === "/api/workspaces" && req.method() === "POST") return req.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test server unavailable. Retry setup." }) });
    if (url.pathname === "/api/worker/start" || url.pathname === "/api/updates/check") return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    return req.continue();
  });
  await page.evaluateOnNewDocument(() => { localStorage.setItem("onboarded", "1"); });
  await page.setViewport({ width: 1280, height: 950 });
  await page.goto(`${a}/welcome`, { waitUntil: "networkidle2" });
  await page.waitForSelector('[aria-labelledby="workspace-onboarding-title"]');
  assert.deepEqual(await page.$$eval('[aria-labelledby="workspace-onboarding-title"] [data-platform-logo]', nodes => nodes.map(node => node.getAttribute("data-platform-logo"))), ["telegram", "whatsapp", "x", "discord"]);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-platform-logo] img')).every(image => image.complete && image.naturalWidth > 0));
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    await sleep(400);
    await page.screenshot({ path: path.join(output, `onboarding-${theme}.png`) });
  }
  await page.click('[aria-labelledby="workspace-onboarding-title"] section:first-of-type button');
  await page.waitForSelector('[aria-label="Connect Telegram"]');
  await page.waitForFunction(() => document.body.textContent.includes("Create your Telegram app once"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Connect Telegram"]'));
  for (const [index, label, guidance] of [[2, "WhatsApp", "Show my QR code"], [3, "X", "One small browser connector"], [4, "Discord", "Search your Discord messages"]]) {
    await page.$eval(`[aria-labelledby="workspace-onboarding-title"] section:nth-of-type(${index}) button`, node => node.click());
    await page.waitForSelector(`[aria-label="Connect ${label}"]`);
    assert.equal(await page.$eval(`[aria-label="Connect ${label}"]`, (node, text) => node.textContent.includes(text), guidance), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(name => !document.querySelector(`[aria-label="Connect ${name}"]`), {}, label);
  }
  await page.setViewport({ width: 390, height: 844 }); await sleep(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "onboarding-mobile.png") });
  await page.$eval('[aria-labelledby="workspace-onboarding-title"] > button', node => node.click());
  await page.waitForFunction(() => location.pathname === "/");
  assert.equal((await api(`${a}/api/workspaces/identity`)).value.setupComplete, true);
  await page.setViewport({ width: 1280, height: 950 });
  await page.waitForSelector('[aria-label="Omni CRM controls"]'); await page.click('[aria-label="Omni CRM controls"]');
  await page.waitForSelector('[aria-label="Workspaces"]');
  await page.screenshot({ path: path.join(output, "switcher.png") });
  await page.$eval('[aria-label="Workspaces"] > button', node => node.click());
  await page.waitForSelector('[aria-labelledby="workspace-create-title"]');
  await sleep(400);
  await page.screenshot({ path: path.join(output, "create.png") });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[aria-labelledby="workspace-create-title"]'));
  await page.$eval('[aria-label="Workspaces"] button', node => node.click());
  await page.waitForFunction(origin => location.origin === origin, {}, base);
  await page.waitForSelector('[aria-label="Omni CRM controls"]'); await page.click('[aria-label="Omni CRM controls"]');
  await page.waitForSelector('[aria-label="Workspaces"]');
  await page.$eval('[aria-label="Workspaces"] > button', node => node.click());
  await page.waitForSelector('[aria-labelledby="workspace-create-title"] input');
  await page.type('[aria-labelledby="workspace-create-title"] input', "Support QA");
  failCreation = true;
  await page.$eval('[aria-labelledby="workspace-create-title"] [type="submit"]', node => node.click());
  await page.waitForFunction(() => document.body.textContent.includes("Test server unavailable"));
  assert.equal((await api(`${base}/api/workspaces`)).value.workspaces.length, 3);
  failCreation = false;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }),
    page.$eval('[aria-labelledby="workspace-create-title"] [type="submit"]', node => node.click()),
  ]);
  assert.notEqual(new URL(page.url()).origin, base);
  await page.waitForSelector('#workspace-onboarding-title');
  assert.equal(await page.$eval('#workspace-onboarding-title', node => node.textContent), "Welcome to Support QA");
  const third = await api(`${new URL(page.url()).origin}/api/workspaces/identity`);
  workspaceIds.push(third.value.id);
  assert.equal((await api(`${new URL(page.url()).origin}/api/accounts`)).value.length, 0);
  // Lifecycle actions operate on exact workspace identities and retain backups.
  assert.equal((await api(`${a}/api/workspaces/${requestId}`, "PATCH", { action: "rename", name: "Studio renamed" })).status, 200);
  assert.equal((await api(`${a}/api/workspaces/identity`)).value.name, "Studio renamed");
  assert.equal((await api(`${base}/api/workspaces/default`, "PATCH", { action: "rename", name: "Home QA" })).status, 200);
  assert.equal((await api(`${base}/api/workspaces/identity`)).value.name, "Home QA");
  assert.equal((await api(`${base}/api/workspaces/${requestId}`, "PATCH", { action: "rename", name: "Home QA" })).status, 400);
  assert.equal((await api(`${base}/api/workspaces/${requestId}`, "PATCH", { action: "unknown" })).status, 400);
  assert.equal((await api(`${base}/api/workspaces/default`, "DELETE", { confirmation: "Home QA" })).status, 400);
  assert.equal((await api(`${a}/api/workspaces/${requestId}`, "DELETE", { confirmation: "Studio renamed" })).status, 409);
  assert.equal((await api(`${base}/api/workspaces/${requestId}`, "DELETE", { confirmation: "Studio QA" })).status, 400);
  const deniedDelete = await fetch(`${base}/api/workspaces/${requestId}`, { method: "DELETE", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" }, body: JSON.stringify({ confirmation: "Studio renamed" }) });
  assert.equal(deniedDelete.status, 403);
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.click('[aria-label="Omni CRM controls"]');
  await page.waitForSelector('[aria-label="Manage Studio renamed"]');
  await page.click('[aria-label="Manage Studio renamed"]');
  await page.$eval('[aria-label="Edit Studio renamed"] input', input => { input.focus(); input.select(); });
  await page.keyboard.type("Studio final");
  await page.$eval('[aria-label="Edit Studio renamed"] [type="submit"]', button => button.click());
  await page.waitForSelector('[aria-label="Manage Studio final"]');
  assert.equal((await api(`${a}/api/workspaces/identity`)).value.name, "Studio final");
  await page.click('[aria-label="Manage Studio final"]');
  await page.$$eval('[aria-label="Edit Studio final"] button', buttons => buttons.find(b => b.textContent.includes("Remove workspace")).click());
  await page.waitForSelector('#workspace-remove-title');
  assert.equal(await page.$eval('[aria-labelledby="workspace-remove-title"] [type="submit"]', b => b.disabled), true);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    await sleep(300); await page.screenshot({ path: path.join(output, `remove-${theme}.png`) });
  }
  await page.setViewport({ width: 390, height: 844 }); await sleep(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "remove-mobile.png") });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('#workspace-remove-title'));
  assert.equal((await api(`${base}/api/workspaces`)).value.workspaces.some(w => w.id === requestId), true);
  await page.setViewport({ width: 1280, height: 950 });
  await page.$$eval('[aria-label="Edit Studio final"] button', buttons => buttons.find(b => b.textContent.includes("Remove workspace")).click());
  await page.waitForSelector('[aria-labelledby="workspace-remove-title"] input');
  await page.type('[aria-labelledby="workspace-remove-title"] input', "Studio final");
  await page.$eval('[aria-labelledby="workspace-remove-title"] [type="submit"]', b => b.click());
  await page.waitForFunction(() => document.body.textContent.includes("Workspace removed. Its local backup is saved."), { timeout: 45000 });
  const backup = path.join(fixture, ".local/removed-workspaces", requestId);
  assert.equal(await fs.readFile(path.join(backup, ".env"), "utf8").then(text => parse(text).APP_ENCRYPTION_KEY), envs[0].APP_ENCRYPTION_KEY);
  const backupDb = await client(backup);
  try { assert.equal(await backupDb.message.count({ where: { id: "studio-message" } }), 1); } finally { await backupDb.$disconnect(); }
  assert.equal((await api(`${base}/api/workspaces`)).value.workspaces.some(w => w.id === requestId), false);
  assert.equal((await api(`${base}/api/workspaces/${requestId}`, "DELETE", { confirmation: "Studio final" })).status, 200);
  assert.equal((await api(`${base}/api/workspaces`, "POST", { requestId, name: "Studio final" })).status, 400);
  assert.equal((await api(`${base}/api/workspaces/${requestId}`, "POST")).status, 400);
  assert.equal((await (await fetch(`${envs[1].SYNC_CONTROL_URL}/health`)).json()).pid, healthB.pid);
  assert.deepEqual((await api(`${base}/api/accounts`)).value.map(row => row.id), ["parent-account"]);
  assert.equal(await fetch(`${a}/api/workspaces/identity`).then(() => true).catch(() => false), false);
  assert.deepEqual(errors, []);
  console.log("PASS: rename from parent and child, collision/CSRF/default/current-workspace guards, exact-name confirmation, UI rename/remove/cancel/light/dark/mobile, atomic backup retaining DB and encryption key, stopped services, retry idempotence and removed-ID resurrection blocked; other workspaces untouched.");
  console.log("PASS: independent databases, sessions, encryption keys, media and search; no Prisma env leakage; cross-workspace IDs denied; same-request retry idempotent; duplicate names/CSRF blocked; isolated worker restart; onboarding, switcher, both themes, mobile, keyboard, and switching home.");
  console.log(`Disposable evidence retained at ${fixture}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error("Browser failure:", page.url(), await page.evaluate(() => document.body.innerText).catch(() => "unavailable"));
  }
  console.error("Fixture:", fixture);
  throw error;
} finally {
  if (browser) await browser.close();
  const created = await fs.readdir(path.join(fixture, ".local/workspaces")).catch(() => []);
  for (const id of created.filter(id => /^[0-9a-f-]{36}$/.test(id))) {
    const file = path.join(fixture, ".local/workspaces", id, ".workspace-runtime.lock/owner.json");
    const owner = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => null);
    if (owner?.pid) { try { process.kill(owner.pid, "SIGTERM"); } catch {} }
  }
  server?.kill("SIGTERM");
}
