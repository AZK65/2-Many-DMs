import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { normalizeTelegramPhone, telegramCredentials, telegramSetupError, validXSession, setupAccountLabel } from "./connection-setup";
import { resolveTelegramSession } from "./telegram-session";
import { createPairCode, pairStatus, claimPairCode, completePairCode, releasePairCode } from "./pairing";
import { connectorZip } from "./connector-zip";
import { sameSetupOrigin } from "./setup-origin";

test("setup rejects cross-site and opaque browser origins while allowing local CLI calls", () => {
  const url = "http://localhost:3000/api/accounts/pair";
  assert.ok(sameSetupOrigin(new Request(url)));
  assert.ok(sameSetupOrigin(new Request(url, { headers: { origin: "http://localhost:3000" } })));
  assert.equal(sameSetupOrigin(new Request(url, { headers: { origin: "https://example.com" } })), false);
  assert.equal(sameSetupOrigin(new Request(url, { headers: { origin: "null" } })), false);
  assert.equal(sameSetupOrigin(new Request(url, { headers: { "sec-fetch-site": "cross-site" } })), false);
  assert.ok(sameSetupOrigin(new Request(url, { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
  assert.equal(sameSetupOrigin(new Request(url, { headers: { host: "localhost:3000", origin: "http://localhost:3001" } })), false);
});

test("phone validation normalizes international numbers but rejects missing country codes and garbage", () => {
  assert.equal(normalizeTelegramPhone(" +1 (202) 555-0147 "), "+12025550147");
  for (const input of ["2025550147", "+00012345678", "+123", "+1234567890123456", "phone +12025550147", null]) assert.equal(normalizeTelegramPhone(input), null);
});
test("Telegram app credentials require a valid ID and hash", () => {
  assert.deepEqual(telegramCredentials("1234", "a".repeat(32)), { apiId: 1234, apiHash: "a".repeat(32) });
  for (const [id, hash] of [[0,"a".repeat(32)],[-1,"a".repeat(32)],[1.5,"a".repeat(32)],[2,"secret"],["NaN","a".repeat(32)]]) assert.equal(telegramCredentials(id, hash), null);
});
test("Telegram errors give recovery actions and honor flood deadlines without leaking provider text", () => {
  assert.equal(telegramSetupError({ errorMessage: "PHONE_CODE_EXPIRED" }).action, "restart");
  assert.equal(telegramSetupError({ errorMessage: "API_ID_INVALID" }).action, "credentials");
  assert.equal(telegramSetupError({ errorMessage: "FLOOD_WAIT_172", seconds: 172 }).retryAfter, 172);
  assert.match(telegramSetupError({ errorMessage: "PASSWORD_HASH_INVALID" }).error, /two-step/);
  assert.doesNotMatch(telegramSetupError(new Error("internal secret=example-secret")).error, /example-secret/);
});
test("encrypted Telegram session payload works without env; legacy sessions still work", () => {
  const env = { TELEGRAM_API_ID: "12", TELEGRAM_API_HASH: "b".repeat(32), TELEGRAM_SESSION: "legacy" };
  assert.equal(resolveTelegramSession(null, env)?.session, "legacy");
  assert.equal(resolveTelegramSession("stored", env)?.session, "stored");
  assert.equal(resolveTelegramSession(JSON.stringify({ apiId: 23, apiHash: "a".repeat(32), session: "new-session" }), {})?.apiId, 23);
  assert.equal(resolveTelegramSession("{broken", env), null);
  assert.equal(resolveTelegramSession(JSON.stringify({ apiId: 23, apiHash: "bad", session: "new-session" }), env), null);
});
test("saved accounts are never represented as live until the worker confirms ready", () => {
  const account = { id: "fixture", platform: "x", label: null, status: "connected" };
  assert.notEqual(setupAccountLabel(account, null), "Connected");
  assert.notEqual(setupAccountLabel(account, { workerRunning: false, platforms: { accounts: [{ accountId: "fixture", state: "ready" }] } }), "Connected");
  assert.equal(setupAccountLabel(account, { workerRunning: true, platforms: { accounts: [{ accountId: "fixture", state: "ready" }] } }), "Connected");
});
test("X session validation rejects missing cookies and header injection", () => {
  assert.ok(validXSession("a".repeat(40), "b".repeat(160)));
  assert.equal(validXSession("a".repeat(40) + "\r\n", "b".repeat(160)), false);
  assert.equal(validXSession(null, "b".repeat(160)), false);
});
test("pairing claims are single flight, recoverable after save failure, and owner scoped", () => {
  const code = createPairCode("fixture-owner");
  assert.equal(pairStatus(code, "different-owner"), null);
  assert.equal(claimPairCode(code.toLowerCase()), "fixture-owner");
  assert.equal(claimPairCode(code), null);
  releasePairCode(code);
  assert.equal(claimPairCode(code), "fixture-owner");
  completePairCode(code, "fixture-account");
  assert.equal(claimPairCode(code), null);
  assert.equal(pairStatus(code, "fixture-owner")?.accountId, "fixture-account");
});
test("pairing expires, including after a successful connection", () => {
  const now = Date.now(); const code = createPairCode("fixture-expiry");
  const clock = mock.method(Date, "now", () => now + 601_000);
  try { assert.equal(pairStatus(code), null); assert.equal(claimPairCode(code), null); } finally { clock.mock.restore(); }
});
test("connector download produces a ZIP with correct offsets and known CRC, and blocks path traversal", () => {
  const zip = connectorZip([{ name: "fixture.txt", data: Buffer.from("123456789") }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  const centralOffset = zip.readUInt32LE(zip.length - 6);
  assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
  assert.equal(zip.subarray(30 + "fixture.txt".length, centralOffset).toString(), "123456789");
  assert.throws(() => connectorZip([{ name: "../secret", data: Buffer.alloc(0) }]));
});
