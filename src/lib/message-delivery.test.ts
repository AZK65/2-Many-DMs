import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryIds, mergeDelivery, mergeDeliveryReceipt, parseDeliveryIds } from "./message-delivery";
import type { MessageDTO } from "./types";

const message = (status: MessageDTO["deliveryStatus"], externalKey: string | null = null): MessageDTO => ({
  id: "client_test", direction: "out", body: "Hello", createdAt: "2026-01-01T00:00:00Z",
  deliveryStatus: status, deliveryError: null, externalKey, mediaType: null, mediaUrl: null,
  mediaName: null, replyToExternalKey: null, replyPreview: null, replySender: null,
  senderContactId: null, senderHandle: null, senderExternalKey: null, senderName: null,
  senderAvatarUrl: null, senderTags: [], reactions: [],
});
test("late queued acknowledgement cannot revert a native sent receipt", () => {
  const sent = message("sent", "x:native-id");
  assert.deepEqual(mergeDelivery(sent, message("pending")), sent);
});
test("late pending snapshots cannot undo failure or uncertainty", () => {
  for (const status of ["failed", "unconfirmed"] as const) {
    assert.equal(mergeDelivery(message(status), message("pending")).deliveryStatus, status);
  }
});
test("late native confirmation can resolve a previously uncertain send", () => {
  assert.equal(mergeDelivery(message("unconfirmed"), message("sent", "x:native")).deliveryStatus, "sent");
});
test("native receipt cannot be overwritten by a stale watchdog result", () => {
  assert.equal(mergeDelivery(message("sent", "x:native"), message("unconfirmed", "x:chat:pending:one")).deliveryStatus, "sent");
});
test("provisional acceptance can still become unconfirmed", () => {
  assert.equal(mergeDelivery(message("sent", "x:chat:pending:one"), message("unconfirmed", "x:chat:pending:one")).deliveryStatus, "unconfirmed");
});
test("delivery refresh preserves reactions, media and body", () => {
  const current = { ...message("pending"), body: "Edited", mediaUrl: "/media/test.png", reactions: [{ emoji: "❤", count: 1, who: ["Demo"] }] };
  const merged = mergeDeliveryReceipt(current, message("sent", "x:native"));
  assert.equal(merged.deliveryStatus, "sent");
  assert.deepEqual(merged.reactions, current.reactions);
  assert.equal(merged.body, "Edited");
  assert.equal(merged.mediaUrl, "/media/test.png");
});
test("unresolved sends are tracked even when 100 newer messages arrive", () => {
  const older = message("pending");
  const newer = Array.from({ length: 100 }, (_, i) => ({ ...message("sent", "x:native"), id: `new-${i}` }));
  assert.deepEqual(deliveryIds([older, ...newer]), ["client_test"]);
});
test("tracking includes provisional and uncertain sends but not incoming or final messages", () => {
  assert.deepEqual(deliveryIds([
    message("sent", "x:native"),
    { ...message("pending"), direction: "in" },
    { ...message("sent", "x:chat:pending:one"), id: "provisional" },
    { ...message("unconfirmed"), id: "uncertain" },
  ]), ["provisional", "uncertain"]);
});
test("receipt lookup IDs are bounded, validated and deduplicated", () => {
  assert.deepEqual(parseDeliveryIds("client_1,client_1,,../bad,one two,client-2"), ["client_1", "client-2"]);
  assert.equal(parseDeliveryIds(Array.from({ length: 200 }, (_, i) => `client_${i}`).join(",")).length, 50);
  assert.deepEqual(parseDeliveryIds(null), []);
});
