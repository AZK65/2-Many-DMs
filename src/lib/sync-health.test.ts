import assert from "node:assert/strict";
import test from "node:test";
import { chatSyncIssue, sourceChatUrl, syncHealthView } from "./sync-health";
import { matchesChatKind, needsReply } from "./inbox-triage";

test("connected is not evidence of complete history", () => {
  const ready = { platform: "x", state: "ready" };
  assert.equal(syncHealthView(ready).tone, "neutral");
  assert.equal(syncHealthView().tone, "attention");
  assert.equal(syncHealthView({ ...ready, sync: { pendingChats: 137, blockedChats: 0 } }).tone, "progress");
  assert.equal(syncHealthView({ ...ready, sync: { pendingChats: 390, blockedChats: 2, lastCheckedAt: 999_000 } }, 1_000_000).label, "Repairing history");
  assert.match(syncHealthView({ ...ready, sync: { pendingChats: 390, blockedChats: 2, lastCheckedAt: 999_000 } }, 1_000_000).detail, /2 paused chats will retry automatically/);
  assert.equal(syncHealthView({ ...ready, sync: { pendingChats: 0, blockedChats: 3 } }).tone, "attention");
  assert.equal(syncHealthView({ platform: "telegram", state: "disconnected", detail: "Session invalidated — reconnect Telegram" }).label, "Reconnect required");
  assert.equal(syncHealthView({ platform: "telegram", state: "disconnected", detail: "Session invalidated — reconnect Telegram" }).detail, "Session invalidated — reconnect Telegram");
  assert.equal(syncHealthView({ ...ready, sync: { pendingChats: 0, blockedChats: 0, lastCheckedAt: 1 } }, 1_000_000).label, "Checks delayed");
  assert.equal(syncHealthView({ ...ready, sync: { pendingChats: 0, blockedChats: 0, lastCheckedAt: 950_000 } }, 1_000_000).label, "Recent inbox checked");
  assert.equal(syncHealthView({ ...ready, sync: { pendingChats: 0, blockedChats: 0, retryAt: 1_100_000 } }, 1_000_000).label, "Sync paused");
});

test("history issues match the exact peer and its forum topics", () => {
  const sync = { pendingChats: 1, blockedChats: 0, chats: [{ externalId: "123", state: "queued" as const }] };
  assert.equal(chatSyncIssue("123__t9", sync)?.state, "queued");
  assert.equal(chatSyncIssue("1234", sync), undefined);
  assert.equal(chatSyncIssue(null, sync), undefined);
});

test("broadcasts do not require a reply, direct and group incoming messages do", () => {
  const chat = { platform: "telegram", isGroup: true, contact: { handle: "Channel" }, lastDirection: "in" };
  assert.equal(needsReply(chat), false);
  assert.equal(matchesChatKind(chat, "channels"), true);
  assert.equal(matchesChatKind(chat, "groups"), false);
  assert.equal(needsReply({ ...chat, contact: { handle: "Group" } }), true);
  assert.equal(needsReply({ ...chat, isGroup: false }), true);
  assert.equal(needsReply({ ...chat, isGroup: false, lastDirection: "out" }), false);
  assert.equal(matchesChatKind({ ...chat, isGroup: false }, "direct"), true);
});

test("native links do not guess a group destination from a phone or handle", () => {
  const c = { platform: "x", externalId: "123-456", inboxCategory: "spam", isGroup: false, contact: { handle: "someone" } };
  assert.equal(sourceChatUrl(c), "https://x.com/i/chat/requests/123-456");
  assert.equal(sourceChatUrl({ ...c, platform: "whatsapp", isGroup: true }), "https://web.whatsapp.com/");
  assert.equal(sourceChatUrl({ ...c, externalId: "https://evil.invalid" }), null);
});
