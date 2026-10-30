import { test } from "node:test";
import assert from "node:assert/strict";
import { findRelationCandidates, type RelationChat, type RelationMember } from "./relation-candidates";

const chat = (id: string, contactId = id, isGroup = true): RelationChat => ({
  id, contactId, isGroup, platform: "telegram", externalId: id, name: id, handle: id,
  email: null, phone: null, company: null, avatarUrl: null, accountLabel: null,
  archived: false, hidden: false, lastMessageAt: "2026-10-30T12:00:00Z",
});
const member = (conversationId: string, id: string, name = id): RelationMember => ({ conversationId, id, name, handle: `@${id}`, email: null, phone: null, avatarUrl: null });
const source = chat("source");

test("suggests shared-member groups and member DMs, never unrelated matching names", () => {
  const chats = [source, chat("group"), chat("direct", "client", false), chat("unrelated")];
  const members = [member("source", "client", "Alex"), member("group", "client", "Alex"), member("unrelated", "other", "Alex")];
  const result = findRelationCandidates({ source, chats, members });
  assert.deepEqual(new Set(result.items.map(item => item.id)), new Set(["group", "direct"]));
  assert.equal(result.items.find(item => item.id === "group")?.sharedCount, 1);
  assert.equal(result.items.find(item => item.id === "direct")?.reason, "member-direct");
});

test("a direct contact finds groups in which that exact contact spoke", () => {
  const direct = chat("direct", "client", false);
  const result = findRelationCandidates({ source: direct, chats: [source, direct, chat("other-direct", "client", false)], members: [member("source", "client")] });
  assert.equal(result.items[0].reason, "same-contact");
  assert.equal(result.items[1].id, source.id);
});

test("excludes linked chats, self and other accounts' copies of the same group", () => {
  const otherAccount = { ...chat("other-account"), externalId: source.externalId };
  const result = findRelationCandidates({ source, chats: [source, otherAccount, chat("linked")], members: [member("source", "person"), member("other-account", "person"), member("linked", "person")], linkedIds: ["linked"] });
  assert.equal(result.total, 0);
});

test("deduplicates repeated sender evidence and prefers distinctive clients to ubiquitous teammates", () => {
  const members = [member("source", "client"), member("source", "team"), member("target", "client"), member("target", "client"), member("team-only", "team"), member("unrelated", "team")];
  const result = findRelationCandidates({ source, chats: [source, chat("target"), chat("team-only")], members });
  assert.equal(result.items[0].id, "target");
  assert.equal(result.items[0].sharedCount, 1);
});

test("manual search includes member email/name and archived/hidden chats without claiming a connection", () => {
  const target = { ...chat("target"), archived: true, hidden: true };
  const members = [{ ...member("target", "other", "Jamie Fox"), email: "jamie@sample.example" }];
  assert.equal(findRelationCandidates({ source, chats: [target], members, query: "JAMIE@sample.example" }).total, 0);
  const result = findRelationCandidates({ source, chats: [target], members, query: "JAMIE@sample.example", scope: "all" });
  assert.equal(result.items[0].reason, null);
  assert.deepEqual(result.items[0].matchedMemberNames, ["Jamie Fox"]);
  assert.equal(result.items[0].archived, true);
});

test("manual search finds contact phone/company and pagination keeps stable distinct results", () => {
  const chats = Array.from({ length: 33 }, (_, index) => ({ ...chat(String(index).padStart(2, "0")), phone: "+12025550147", company: "Example Studio" }));
  const first = findRelationCandidates({ source, chats, members: [], scope: "all", query: "Example Studio" });
  const second = findRelationCandidates({ source, chats, members: [], scope: "all", query: "+12025550147", offset: first.nextOffset! });
  assert.equal(first.total, 33); assert.equal(first.items.length, 20); assert.equal(second.items.length, 13);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 33);
  assert.equal(second.nextOffset, null);
});

test("unknown membership never implies shared people", () => {
  assert.equal(findRelationCandidates({ source, chats: [chat("other")], members: [] }).total, 0);
});
