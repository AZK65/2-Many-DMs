import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageDTO } from "./types";
import { mergeDeliveryReceipt } from "./message-delivery";
import { mergeMessageWindow, orderMessageWindow, projectMessageTimeline } from "./message-timeline";

// Entirely synthetic. Never use real chats/screenshots in public fixtures.
const body = "Please help with the example account.\n\n" + "Here is some context for the request. ".repeat(6);
const at = Date.parse("2026-01-01T14:00:00Z");
function message(id: string, minute: number, patch: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id, externalKey: `x:${String(1000000000000000000n + BigInt(id.replace(/\D/g, "") || "1"))}`,
    body, createdAt: new Date(at + minute * 60_000).toISOString(), direction: "in",
    mediaType: null, mediaUrl: null, mediaName: null, senderName: null, senderAvatarUrl: null,
    senderTags: [], reactions: [], replyToExternalKey: null, replyPreview: null, replySender: null, ...patch,
  };
}
const native = message("native1", 0);
const preview = message("preview1", 33, { externalKey: "x:preview:one", body: body.slice(0, 200).trim() });
const reply = message("client_reply2", 135, { direction: "out", body: "I can help with your request.", deliveryStatus: "sent" });
const ids = (messages: MessageDTO[]) => messages.map(row => row.id);
const project = (messages: MessageDTO[]) => projectMessageTimeline(messages, "x");

test("a clipped snapshot, reply, then delayed native history displays one incoming message in chronological order", () => {
  const raw = mergeMessageWindow([preview, reply], [native]);
  const result = project(raw);
  assert.deepEqual(ids(raw), [native.id, preview.id, reply.id], "storage remains intact");
  assert.deepEqual(ids(result.messages), [native.id, reply.id]);
  assert.equal(result.messages[0].body, body);
  assert.equal(result.aliases.get(preview.id), native.id, "search/reply deep links follow the full message");
});

test("all arrival permutations, duplicate polls and page overlaps converge to the same timeline", () => {
  for (const order of [[native, preview, reply], [native, reply, preview], [preview, native, reply],
    [preview, reply, native], [reply, preview, native], [reply, native, preview]]) {
    let state: MessageDTO[] = [];
    for (const row of order) state = mergeMessageWindow(state, [row, row]);
    for (let poll = 0; poll < 10; poll++) state = mergeMessageWindow(state, order);
    assert.equal(state.length, 3);
    assert.deepEqual(ids(project(state).messages), [native.id, reply.id]);
    assert.equal(mergeMessageWindow(state, order), state, "unchanged polls preserve references");
  }
});

test("every chat uses the same policy, independent of its native key or inbox category", () => {
  for (let chat = 1; chat <= 100; chat++) {
    const full = message(`native${chat}`, 0);
    const snapshots = Array.from({ length: 15 }, (_, index) => message(`snapshot-${index}`, (index + 1) * 10,
      { externalKey: `x:preview:${chat}-${index}`, body: full.body.slice(0, 200).trim() }));
    assert.deepEqual(ids(project([...snapshots, full]).messages), [full.id]);
  }
});

test("new and unmatched previews remain visible; identical snapshot observations coalesce without deleting rows", () => {
  const second = { ...preview, id: "preview2", externalKey: "x:preview:two", createdAt: reply.createdAt };
  assert.deepEqual(ids(project([preview, reply, second]).messages), [preview.id, reply.id]);
  assert.equal(project([preview, second]).aliases.get(second.id), preview.id);
  assert.equal(project([preview]).messages[0], preview);
  assert.equal(project([preview, { ...native, body: "Different content" }]).messages.length, 2);
});

test("distinct native IDs with identical text are NEVER coalesced", () => {
  const repeated = message("native2", 2);
  const result = project([preview, native, repeated]);
  assert.deepEqual(ids(result.messages), [native.id, repeated.id]);
  assert.equal(result.aliases.get(preview.id), repeated.id);
  assert.deepEqual(result.messages.map(row => row.externalKey), [native.externalKey, repeated.externalKey]);
});

test("ambiguous clipped prefixes, opposite directions and intervening native messages are preserved", () => {
  const cases = [
    [preview, native, message("native2", 1, { body: `${body.slice(0, 200)} A different ending.` })],
    [preview, { ...native, direction: "out" as const }],
    [native, message("native2", 2, { body: "Another incoming message" }), preview],
    [preview, message("native2", 200)],
    [{ ...preview, body: "Please help" }, native],
    [{ ...preview, createdAt: "unknown" }, native],
  ];
  for (const rows of cases) assert.equal(project(rows).messages.length, rows.length);
});

test("minute rounding works but arbitrary future native messages cannot explain earlier snapshots", () => {
  assert.deepEqual(ids(project([preview, { ...native, createdAt: new Date(at + 34 * 60_000).toISOString() }]).messages), [native.id]);
  assert.equal(project([preview, { ...native, createdAt: new Date(at + 36 * 60_000).toISOString() }]).messages.length, 2);
});

test("protected annotations, media and durable local sends remain accessible", () => {
  const protectedFields: Partial<MessageDTO>[] = [
    { id: "client_local", direction: "out", deliveryStatus: "pending" },
    { pinnedAt: native.createdAt }, { originalBody: "Saved draft" }, { translatedBody: "Saved translation" },
    { reactions: [{ emoji: "❤", count: 1, who: ["Example"] }] },
    { replyToExternalKey: "x:123456789012345" }, { mediaType: "image" }, { mediaUrl: "/example.png" },
  ];
  for (const patch of protectedFields) {
    const protectedRow = { ...preview, ...patch };
    assert.equal(project([protectedRow, { ...native, direction: protectedRow.direction }]).messages.length, 2);
  }
});

test("a stale in-flight response cannot downgrade an in-place native promotion or erase its media", () => {
  const promoted = { ...native, id: preview.id, mediaType: "image" as const, mediaUrl: "/example.png" };
  assert.equal(mergeMessageWindow([promoted], [preview])[0], promoted);
});

test("delivery timestamp corrections reorder rows without losing receipts, body or reactions", () => {
  const pending = message("client_send3", 140, { direction: "out", deliveryStatus: "pending", externalKey: "x:chat:pending:one" });
  const received = message("client_send3", 120, { direction: "out", deliveryStatus: "sent" });
  const corrected = mergeDeliveryReceipt(pending, received);
  assert.deepEqual(ids(orderMessageWindow([native, reply, corrected])), [native.id, pending.id, reply.id]);
  const merged = mergeMessageWindow([corrected], [pending]);
  assert.equal(merged[0].deliveryStatus, "sent");
  assert.equal(merged[0].createdAt, received.createdAt);
});

test("stable timestamp ties retain platform order, unknown dates go last, and input is not mutated", () => {
  const second = message("native2", 0);
  const invalid = { ...preview, createdAt: "unknown" };
  const input = [invalid, reply, second, native];
  assert.deepEqual(ids(orderMessageWindow(input)), [second.id, native.id, reply.id, invalid.id]);
  assert.deepEqual(ids(input), [invalid.id, reply.id, second.id, native.id]);
});

test("non-X platforms never get text-based projection; cache reload is idempotent", () => {
  for (const platform of ["telegram", "whatsapp", "discord"]) {
    assert.equal(projectMessageTimeline([preview, native], platform).messages.length, 2);
  }
  const once = project([preview, reply, native]);
  assert.deepEqual(project(once.messages).messages, once.messages);
});
