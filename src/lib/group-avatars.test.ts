import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarSource, buildGroupPreviews, groupPeopleLabel, type ObservedGroupMember } from "./group-avatars";

const member = (id: string, avatarUrl: string | null = null, conversationId = "group-a"): ObservedGroupMember =>
  ({ conversationId, id, name: `Person ${id}`, avatarUrl, lastSeen: 10 });

test("group previews use exact sender identity and never merge matching names across groups", () => {
  const previews = buildGroupPreviews([
    { ...member("a"), name: "Alex" }, { ...member("b"), name: "Alex" }, member("a", null, "group-b"),
  ]);
  assert.equal(previews.get("group-a")?.count, 2);
  assert.equal(previews.get("group-b")?.count, 1);
  assert.equal(previews.get("missing"), undefined);
});

test("deduplicates senders and keeps their latest photo", () => {
  const previews = buildGroupPreviews([member("a"), { ...member("a", "/avatars/new.jpg"), lastSeen: 20n }]);
  assert.equal(previews.get("group-a")?.count, 1);
  assert.equal(previews.get("group-a")?.members[0].avatarUrl, "/avatars/new.jpg");
});

test("prefers photos, caps at four, keeps identity positions stable, and retains full observed count", () => {
  const rows = [member("a"), member("b"), ...["c", "d", "e", "f", "g"].map(id => member(id, `/avatars/${id}.jpg`))];
  const preview = buildGroupPreviews(rows).get("group-a")!;
  assert.equal(preview.count, 7);
  assert.deepEqual(preview.members.map(m => m.id), ["c", "d", "e", "f"]);
  assert.deepEqual(buildGroupPreviews([...rows].reverse()).get("group-a"), preview);
  assert.equal(groupPeopleLabel(preview), "Person c, Person d +5");
});

test("does not show the same photo as multiple people, including URL versions", () => {
  const preview = buildGroupPreviews([
    member("a", "/avatars/same.jpg?v=1"), member("b", "/api/avatars/same.jpg?v=2"), member("c", "/avatars/other.jpg"),
  ]).get("group-a")!;
  assert.equal(preview.count, 3);
  assert.deepEqual(preview.members.map(m => m.id), ["a", "c"]);
});

test("missing photos retain named placeholders without inventing image URLs", () => {
  const preview = buildGroupPreviews([member("a"), member("b")]).get("group-a")!;
  assert.ok(preview.members.every(m => m.avatarUrl === null));
  assert.equal(groupPeopleLabel(preview), "Person a, Person b");
  assert.equal(buildGroupPreviews([]).size, 0);
});

test("external query parameters may identify different photos and must not be removed", () => {
  const preview = buildGroupPreviews([
    member("a", "https://example.com/photo?id=1"), member("b", "https://example.com/photo?id=2"),
  ]).get("group-a")!;
  assert.equal(preview.members.length, 2);
});

test("runtime avatar URLs preserve versions and external sources", () => {
  assert.equal(avatarSource("/avatars/a.jpg?v=2"), "/api/avatars/a.jpg?v=2");
  assert.equal(avatarSource("/api/avatars/a.jpg"), "/api/avatars/a.jpg");
  assert.equal(avatarSource("https://example.com/a.jpg"), "https://example.com/a.jpg");
  assert.equal(avatarSource(null), null);
});

test("leads with distinctive people rather than the same shared teammate in every group", () => {
  const previews = buildGroupPreviews([
    member("a-team", "/avatars/team.jpg"), member("z-client", "/avatars/client.jpg"),
    member("a-team", "/avatars/team.jpg", "group-b"),
  ]);
  assert.equal(previews.get("group-a")?.members[0].id, "z-client");
  assert.equal(previews.get("group-a")?.members[1].id, "a-team");
});
