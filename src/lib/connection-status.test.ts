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
