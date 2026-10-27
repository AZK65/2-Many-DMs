import assert from "node:assert/strict";
import test from "node:test";
import { buildPeopleNetwork, findNetworkPath, possibleIdentityMatches, type NetworkContact, type NetworkChat } from "./people-network";

const person = (id: string, name: string, extra: Partial<NetworkContact> = {}): NetworkContact => ({ id, name, handle: name, email: null, phone: null, externalKey: `telegram:${id}`, ...extra });
const chat = (id: string, isGroup = true, contactId = "group"): NetworkChat => ({ id, contactId, name: id, platform: "telegram", isGroup, externalId: id });
const member = (contactId: string, conversationId: string, lastSeen = "2026-10-22T12:00:00Z") => ({ contactId, conversationId, lastSeen });

test("same name alone stays separate and is offered for double-checking", () => {
  const data = buildPeopleNetwork([person("a", "Nick Smith"), person("b", "Nick Smith", { externalKey: "x:b" })], [chat("g")], [member("a", "g"), member("b", "g")]);
  assert.equal(data.people.length, 2);
  assert.equal(possibleIdentityMatches(data.people[0], data.people)[0].shared, 1);
});
test("matching name and verified phone combines only the read-only projection", () => {
  const contacts = [person("a", "Nick Smith", { phone: "+1 (514) 555-0100" }), person("b", "Nick Smith", { phone: "+15145550100", externalKey: "x:b" })];
  const data = buildPeopleNetwork(contacts, [chat("g"), chat("dm", false, "b")], [member("a", "g"), member("b", "g")]);
  assert.equal(data.people.length, 1); assert.equal(data.groups[0].members.length, 1);
  assert.equal(data.people[0].directChats[0].id, "dm"); assert.equal(contacts.length, 2);
});
test("WhatsApp LID must not be treated as a phone", () => {
  const data = buildPeopleNetwork([person("a", "Nick", { externalKey: "whatsapp:15145550100@lid", phone: "+15145550100" }), person("b", "Nick", { phone: "+15145550100" })], [chat("g")], [member("a", "g"), member("b", "g")]);
  assert.equal(data.people.length, 2);
});
test("same email corroborated by name combines, shared mailbox with different names does not", () => {
  const data = buildPeopleNetwork([person("a", "Nick Smith", { email: "NICK@example.com" }), person("b", "Nick Smith", { email: "nick@example.com" }), person("c", "Alex Smith", { email: "nick@example.com" })], [chat("g")], [member("a", "g"), member("b", "g"), member("c", "g")]);
  assert.equal(data.people.length, 2);
});
test("generic names do not trigger suggestions or joins via shared email", () => {
  const data = buildPeopleNetwork([person("a", "WhatsApp member", { email: "team@example.com" }), person("b", "WhatsApp member", { email: "team@example.com" })], [chat("g")], [member("a", "g"), member("b", "g")]);
  assert.equal(data.people.length, 2); assert.equal(possibleIdentityMatches(data.people[0], data.people).length, 0);
});
test("duplicate group syncs deduplicate by platform identity; same-name groups do not", () => {
  const data = buildPeopleNetwork([person("a", "Alex")], [chat("g"), { ...chat("g2"), externalId: "g" }, { ...chat("g3"), name: "g" }], [member("a", "g", "2026-10-20T12:00:00Z"), member("a", "g2"), member("a", "g3")]);
  assert.equal(data.groups.length, 2); assert.equal(data.groups[0].members.length, 1);
  assert.equal(data.groups[0].members[0].lastSeen, "2026-10-22T12:00:00Z");
});
test("finds shortest introduction path and respects hop limit", () => {
  const data = buildPeopleNetwork([person("a", "Alex"), person("b", "Bruno"), person("c", "Claire"), person("d", "Disconnected")], [chat("g1"), chat("g2"), chat("dm", false, "d")], [member("a", "g1"), member("b", "g1"), member("b", "g2"), member("c", "g2")]);
  assert.deepEqual(findNetworkPath(data, "a", "c"), [{ personId: "b", groupId: "telegram:g1" }, { personId: "c", groupId: "telegram:g2" }]);
  assert.equal(findNetworkPath(data, "a", "c", 1), null);
  assert.equal(findNetworkPath(data, "a", "d"), null);
  assert.equal(findNetworkPath(data, "missing", "c"), null);
});
test("does not invent membership for DMs, unknown senders, or empty groups", () => {
  const data = buildPeopleNetwork([person("a", "Alex")], [chat("dm", false, "a"), chat("empty")], [member("a", "dm"), member("unknown", "empty")]);
  assert.equal(data.groups.length, 0); assert.equal(data.people[0].groupIds.length, 0);
});
test("identity matching and canonical IDs are deterministic across input order", () => {
  const contacts = [person("c", "Alex Smith", { email: "a@b.com" }), person("a", "Alex Smith", { email: "a@b.com" })];
  const x = buildPeopleNetwork(contacts, [chat("g")], [member("a", "g")]);
  const y = buildPeopleNetwork([...contacts].reverse(), [chat("g")], [member("a", "g")]);
  assert.deepEqual(x.people, y.people);
});
