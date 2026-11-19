import assert from "node:assert/strict";
import test from "node:test";
import { xInboxVerified, xNeedsUnlock } from "./x-unlock-state";

test("connection setup needs inbox evidence, not simply a running browser", () => {
  assert.equal(xInboxVerified({ state: "ready" }), false);
  assert.equal(xInboxVerified({ state: "ready", sync: { lastCheckedAt: 1 } }), true);
  assert.equal(xInboxVerified({ state: "ready", sync: { lastCheckedAt: 1, retryAt: Date.now() + 10000 } }), false);
  for (const state of ["required", "verifying", "rejected", "error", "login-required"] as const) {
    assert.equal(xInboxVerified({ state: "ready", unlock: { state, detail: "" }, sync: { lastCheckedAt: 1 } }), false);
  }
  assert.equal(xInboxVerified({ state: "ready", unlock: { state: "unlocked", detail: "" } }), true);
});

test("setup distinguishes passcode locks from an expired account login", () => {
  assert.equal(xNeedsUnlock({ detail: "XChat locked" }), true);
  assert.equal(xNeedsUnlock({ unlock: { state: "rejected", detail: "Check your code" } }), true);
  assert.equal(xNeedsUnlock({ detail: "Unlock needs login", unlock: { state: "login-required", detail: "Sign in again" } }), false);
  assert.equal(xNeedsUnlock({ unlock: { state: "unlocked", detail: "Inbox verified" } }), false);
});
