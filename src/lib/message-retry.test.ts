import assert from "node:assert/strict";
import test from "node:test";
import {
  canRetryFailedMessageInPlace,
  findSupersedingSentMessage,
} from "./message-retry";

test("allows a definitely-unsent text-only X message to reuse its row", () => {
  assert.equal(
    canRetryFailedMessageInPlace("x", {
      deliveryStatus: "failed",
      externalKey: null,
      mediaType: null,
    }),
    true
  );
});

test("never reuses uncertain, accepted, media, or non-X messages", () => {
  assert.equal(
    canRetryFailedMessageInPlace("x", {
      deliveryStatus: "unconfirmed",
      externalKey: null,
      mediaType: null,
    }),
    false
  );
  assert.equal(
    canRetryFailedMessageInPlace("x", {
      deliveryStatus: "failed",
      externalKey: "x:accepted:1",
      mediaType: null,
    }),
    false
  );
  assert.equal(
    canRetryFailedMessageInPlace("x", {
      deliveryStatus: "failed",
      externalKey: null,
      mediaType: "image",
    }),
    false
  );
  assert.equal(
    canRetryFailedMessageInPlace("telegram", {
      deliveryStatus: "failed",
      externalKey: null,
      mediaType: null,
    }),
    false
  );
});

test("finds only a nearby successful X resend with the same text", () => {
  const failed = {
    id: "client_failed",
    body: "Please send the account ID",
    createdAt: "2026-11-04T15:30:00.000Z",
    direction: "out",
    deliveryStatus: "failed",
    externalKey: null,
    mediaType: null,
  };
  const sent = {
    ...failed,
    id: "client_sent",
    createdAt: "2026-11-04T15:32:00.000Z",
    deliveryStatus: "sent",
  };
  assert.equal(findSupersedingSentMessage("x", failed, [failed, sent]), sent);
  assert.equal(findSupersedingSentMessage("telegram", failed, [sent]), undefined);
  assert.equal(
    findSupersedingSentMessage("x", failed, [
      { ...sent, body: "A genuinely different message" },
    ]),
    undefined
  );
  assert.equal(
    findSupersedingSentMessage("x", failed, [
      { ...sent, createdAt: "2026-11-04T15:41:00.000Z" },
    ]),
    undefined
  );
});
