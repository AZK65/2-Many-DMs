import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageDTO } from "./types";
import { pendingMediaIds, mergeMediaUpdates } from "./message-media";
import { mergeMessageWindow } from "./message-timeline";

const photo: MessageDTO = {
  id: "photo1", externalKey: "x:100000000000000001", direction: "in", body: "Caption",
  createdAt: "2026-01-01T00:00:00.000Z", mediaType: "image", mediaUrl: null, mediaName: "Photo.jpg",
  senderName: "Example sender", senderAvatarUrl: null, senderTags: [], reactions: [{ emoji: "❤", count: 1, who: [] }],
  replyToExternalKey: null, replyPreview: null, replySender: null,
};
const downloaded = { ...photo, mediaUrl: "/media/example.jpg", mediaIsGif: false };

test("an old missing photo remains in the refresh list beyond the newest 40 messages", () => {
  const later = Array.from({ length: 75 }, (_, i) => ({ ...photo, id: `text${i}`, mediaType: null, createdAt: `2026-01-02T00:00:00.000Z` }));
  const current = [photo, ...later];
  assert.deepEqual(pendingMediaIds(current), [photo.id]);
  const next = mergeMediaUpdates(mergeMessageWindow(current, later.slice(-40)), [downloaded]);
  assert.equal(next[0].mediaUrl, downloaded.mediaUrl);
  assert.equal(next[0].body, photo.body);
  assert.equal(next[0].reactions, photo.reactions);
  assert.deepEqual(pendingMediaIds(next), []);
  assert.equal(mergeMediaUpdates(next, [downloaded]), next);
});

test("stale polls cannot erase completed media but genuine edits and deletions win", () => {
  assert.equal(mergeMessageWindow([downloaded], [photo])[0].mediaUrl, downloaded.mediaUrl);
  assert.equal(mergeMessageWindow([downloaded], [{ ...photo, deletedAt: "2026-01-03T00:00:00Z" }])[0].mediaUrl, null);
  assert.equal(mergeMessageWindow([downloaded], [{ ...photo, editedAt: "2026-01-03T00:00:00Z" }])[0].mediaUrl, null);
  assert.equal(mergeMessageWindow([downloaded], [{ ...photo, externalKey: "x:different" }])[0].mediaUrl, null);
});

test("partial receipts cannot resurrect removed rows, revert edits or cross message identities", () => {
  for (const patch of [{ externalKey: "x:other" }, { editedAt: "2026-01-03T00:00:00Z" }, { deletedAt: "2026-01-03T00:00:00Z" }]) {
    const current = [{ ...photo, ...patch }];
    assert.equal(mergeMediaUpdates(current, [downloaded]), current);
  }
  assert.deepEqual(mergeMediaUpdates([], [downloaded]), []);
  assert.equal(mergeMediaUpdates([photo], [{ ...downloaded, deletedAt: "2026-01-03T00:00:00Z" }])[0], photo);
});

test("refresh IDs are bounded, safe and exclude unsaved or deleted media", () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ ...photo, id: `photo${i}` }));
  const ids = pendingMediaIds([...rows, { ...photo, id: "../unsafe" }, { ...photo, id: "draft", externalKey: null }, { ...photo, id: "deleted", deletedAt: "2026-01-03" }]);
  assert.ok(ids.length <= 50);
  assert.ok(!ids.includes("../unsafe") && !ids.includes("draft") && !ids.includes("deleted"));
});
