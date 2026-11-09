import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { startLogin, verifyLogin, cancelLogin } from "./telegram-login";

test("Telegram login survives bad codes and database retries, but cannot cross users", async () => {
  const calls: string[] = [];
  mock.method(TelegramClient.prototype, "connect", async () => true);
  mock.method(TelegramClient.prototype, "disconnect", async () => { calls.push("disconnect"); });
  mock.method(TelegramClient.prototype, "sendCode", async () => ({ phoneCodeHash: "fake", isCodeViaApp: true }));
  mock.method(StringSession.prototype, "save", () => "fixture-session");
  mock.method(TelegramClient.prototype, "invoke", async (request: { phoneCode: string }) => {
    calls.push("verify");
    if (request.phoneCode === "00000") throw { errorMessage: "PHONE_CODE_INVALID" };
    return {};
  });
  try {
    const started = await startLogin("owner-1", "+12025550147", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("loginId" in started);
    const id = started.loginId!;
    const duplicate = await startLogin("owner-1", "+12025550147", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("error" in duplicate);
    assert.equal((await verifyLogin("another-owner", id, "12345")).status, "error");
    assert.equal(calls.length, 0);
    const bad = await verifyLogin("owner-1", id, "00000");
    assert.equal(bad.status, "error");
    const good = await verifyLogin("owner-1", id, "12345");
    assert.equal(good.status, "ok");
    assert.deepEqual(await verifyLogin("owner-1", id, "12345"), good);
    assert.equal(calls.filter(c => c === "verify").length, 2);
    assert.ok(calls.includes("disconnect"));
    if (good.status === "ok") assert.equal(JSON.parse(good.session).apiId, 1234);
    await cancelLogin(id, "owner-1");
    assert.equal((await verifyLogin("owner-1", id, "12345")).status, "error");
  } finally { mock.restoreAll(); }
});
test("Telegram password step does not consume the phone code again", async () => {
  let signIns = 0;
  mock.method(TelegramClient.prototype, "connect", async () => true);
  mock.method(TelegramClient.prototype, "disconnect", async () => {});
  mock.method(TelegramClient.prototype, "sendCode", async () => ({ phoneCodeHash: "fake", isCodeViaApp: true }));
  mock.method(TelegramClient.prototype, "invoke", async () => { signIns++; throw { errorMessage: "SESSION_PASSWORD_NEEDED" }; });
  try {
    const started = await startLogin("owner-2", "+12025550148", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("loginId" in started);
    assert.equal((await verifyLogin("owner-2", started.loginId!, "12345")).status, "needs_password");
    assert.equal((await verifyLogin("owner-2", started.loginId!, "12345")).status, "needs_password");
    assert.equal(signIns, 1);
    await cancelLogin(started.loginId!, "owner-2");
  } finally { mock.restoreAll(); }
});
test("failed Telegram send cleans up the temporary client and preserves provider cooldown", async () => {
  let disconnected = false;
  mock.method(TelegramClient.prototype, "connect", async () => true);
  mock.method(TelegramClient.prototype, "disconnect", async () => { disconnected = true; });
  mock.method(TelegramClient.prototype, "sendCode", async () => { throw { errorMessage: "FLOOD_WAIT_120", seconds: 120 }; });
  try {
    const result = await startLogin("owner-3", "+12025550149", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("error" in result); assert.equal(result.retryAfter, 120); assert.ok(disconnected);
    const retry = await startLogin("owner-3", "+12025550149", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("error" in retry); assert.ok((retry.retryAfter ?? 0) >= 119);
  } finally { mock.restoreAll(); }
});
test("non-rate-limited Telegram failures can retry immediately", async () => {
  let attempts = 0;
  let requestRetries = 0;
  mock.method(TelegramClient.prototype, "connect", async () => true);
  mock.method(TelegramClient.prototype, "disconnect", async () => {});
  mock.method(TelegramClient.prototype, "sendCode", async function (this: TelegramClient) {
    requestRetries = (this as unknown as { _requestRetries?: number })._requestRetries ?? 0;
    attempts++;
    if (attempts === 1) throw new Error("Not connected");
    return { phoneCodeHash: "fake", isCodeViaApp: true };
  });
  try {
    const first = await startLogin("owner-4", "+12025550150", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("error" in first); assert.equal(first.retryAfter, undefined);
    const retry = await startLogin("owner-4", "+12025550150", { apiId: 1234, apiHash: "a".repeat(32) });
    assert.ok("loginId" in retry);
    assert.ok(requestRetries >= 2, "Telegram needs a second request attempt to follow PHONE_MIGRATE redirects");
    if ("loginId" in retry) await cancelLogin(retry.loginId!, "owner-4");
  } finally { mock.restoreAll(); }
});
