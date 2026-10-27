import { test } from "node:test";
import assert from "node:assert/strict";
import { showDirectMessageTimestamp } from "./direct-message-layout";

const middle = { lastOfRun: false, focused: false, deliveryStatus: undefined, externalKey: null };

test("routine direct messages share one visible timestamp at the end of a run", () => {
  assert.equal(showDirectMessageTimestamp(middle), false);
  assert.equal(showDirectMessageTimestamp({ ...middle, deliveryStatus: "sent" }), false);
  assert.equal(showDirectMessageTimestamp({ ...middle, lastOfRun: true }), true);
});

test("delivery uncertainty and pending sends stay visible even within a run", () => {
  for (const deliveryStatus of ["failed", "unconfirmed", "pending", "sending"] as const) {
    assert.equal(showDirectMessageTimestamp({ ...middle, deliveryStatus }), true);
  }
});

test("focused messages and unverified X previews retain their visible timestamp", () => {
  assert.equal(showDirectMessageTimestamp({ ...middle, focused: true }), true);
  assert.equal(showDirectMessageTimestamp({ ...middle, externalKey: "x:preview:example" }), true);
  assert.equal(showDirectMessageTimestamp({ ...middle, externalKey: "x:message:example" }), false);
});
