import assert from "node:assert/strict";
import test from "node:test";
import { accountStatusView, livePlatformStatuses } from "./connection-status";

test("stored connected accounts never override absent or unhealthy live status", () => {
  const account = { status: "connected" };
  assert.equal(accountStatusView(account).connected, false);
  for (const state of ["qr", "starting", "disabled", "disconnected"] as const) {
    assert.equal(accountStatusView(account, { state }).connected, false);
  }
  assert.equal(accountStatusView(account, { state: "qr" }).label, "Scan QR");
  assert.equal(accountStatusView(account, { state: "ready" }).connected, true);
});

test("restart badges use current status without credentials or historical fallbacks", () => {
  assert.deepEqual(livePlatformStatuses(null), {});
  assert.deepEqual(livePlatformStatuses({
    initialized: true, accounts: [{ qr: "secret" }],
    whatsapp: { state: "qr", detail: "Scan QR", qr: "secret" },
  }), { whatsapp: { platform: "whatsapp", state: "qr", detail: "Scan QR" } });
});

test("history progress reaches the connection panel without forwarding private chat records", () => {
  const history = { recentReady: 34, recentPending: 69, olderPending: 34, completed: 0, discovering: true, pagesFetched: 34, lastProgressAt: 1000 };
  const result = livePlatformStatuses({ x: { state: "ready", sync: { pendingChats: 103, blockedChats: 0, history: { ...history, secret: "must not pass" }, chats: [{ externalId: "private" }] } } });
  assert.deepEqual(result.x.sync?.history, history);
  assert.equal(result.x.sync?.chats, undefined);
});
