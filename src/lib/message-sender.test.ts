import { test } from "node:test";
import assert from "node:assert/strict";
import { groupMessageSender, messageSenderKey } from "./message-sender";

type Sender = Parameters<typeof groupMessageSender>[0];
const sender = (overrides: Partial<Sender> = {}): Sender => ({
  id: "message-a", direction: "in", senderName: "Alex", senderContactId: "person-a",
  senderExternalKey: "telegram:123", senderHandle: "@alex", senderAvatarUrl: "/avatars/alex.jpg", ...overrides,
});

test("same speaker stays grouped and keeps their color after a name change", () => {
  const before = sender();
  const after = sender({ id: "message-b", senderName: "Alex Smith" });
  assert.equal(messageSenderKey(before, true), messageSenderKey(after, true));
  assert.deepEqual(groupMessageSender(before).tone, groupMessageSender(after).tone);
});

test("different people with identical names never share a message run", () => {
  assert.notEqual(messageSenderKey(sender(), true), messageSenderKey(sender({ senderExternalKey: "telegram:456", senderContactId: "person-b" }), true));
});

test("contact IDs identify speakers when platform IDs are unavailable", () => {
  assert.equal(messageSenderKey(sender({ senderExternalKey: null }), true), "contact:person-a");
});

test("unidentified speakers cannot be merged merely by matching names or handles", () => {
  const a = sender({ senderExternalKey: null, senderContactId: null });
  assert.notEqual(messageSenderKey(a, true), messageSenderKey({ ...a, id: "message-b" }, true));
});

test("missing names use their own handle, then an honest group-member fallback", () => {
  assert.equal(groupMessageSender(sender({ senderName: "  " })).name, "@alex");
  const missing = groupMessageSender(sender({ senderName: null, senderHandle: null, senderAvatarUrl: null }));
  assert.equal(missing.name, "Group member");
  assert.equal(missing.avatarUrl, null);
});

test("a known sender photo is retained even when their name has not synced", () => {
  assert.equal(groupMessageSender(sender({ senderName: null })).avatarUrl, "/avatars/alex.jpg");
});

test("direct chats and outgoing sequences retain their existing grouping", () => {
  assert.equal(messageSenderKey(sender(), false), messageSenderKey(sender({ senderName: null }), false));
  assert.equal(messageSenderKey(sender({ direction: "out" }), true), "self");
  assert.notEqual(messageSenderKey(sender(), false), messageSenderKey(sender({ direction: "out" }), false));
});
