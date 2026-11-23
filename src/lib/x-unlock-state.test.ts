import assert from "node:assert/strict";
import test from "node:test";
import { isXChatPin, latestXUnlockState, xUnlockCheckExpired, xInboxVerified, xNeedsUnlock } from "./x-unlock-state";

test("X Chat accepts exactly four digits and preserves leading zeroes", () => {
  assert.equal(isXChatPin("0123"), true);
  for (const input of ["", "123", "12345", "123456", "12a4", "１２３４", 1234, null]) assert.equal(isXChatPin(input), false);
});

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

test("old polling cannot hide a completed attempt, and newer success replaces an old error", () => {
  const checking = { state: "verifying" as const, detail: "checking", startedAt: 100, updatedAt: 110 };
  const failed = { state: "error" as const, detail: "unknown", startedAt: 100, updatedAt: 200 };
  const success = { state: "unlocked" as const, detail: "confirmed", updatedAt: 300 };
  assert.equal(latestXUnlockState(checking, failed), failed);
  assert.equal(latestXUnlockState(success, failed), success);
  assert.equal(latestXUnlockState(undefined, failed), failed);
  assert.equal(xUnlockCheckExpired(1000, 60_999), false);
  assert.equal(xUnlockCheckExpired(1000, 61_000), true);
});
