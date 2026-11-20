import assert from "node:assert/strict";
import { test } from "node:test";
import bigInt from "big-integer";
import { createRequire } from "node:module";
const requireProtocol = createRequire(import.meta.url);
const { Api } = (() => { try { return requireProtocol("telegram"); } catch { return requireProtocol("teleproto"); } })();
import { addBaileysGroupMember, addWebGroupMember, addTelegramGroupMember, membershipError } from "./group-member-transports";

for (const [code, status] of [["200", "added"], ["409", "already_member"], ["403", "not_added"], ["404", "not_added"], ["408", "not_added"], ["419", "not_added"], ["unknown", "unknown"]] as const) {
  test(`WhatsApp native outcome ${code} is ${status}`, async () => {
    const sock = { groupMetadata: async () => ({ participants: [] }), groupParticipantsUpdate: async (group: string, people: string[], action: string) => {
      assert.equal(group, "123@g.us"); assert.deepEqual(people, ["15551234567@s.whatsapp.net"]); assert.equal(action, "add");
      return [{ jid: people[0], status: code }];
    } };
    assert.equal((await addBaileysGroupMember(sock, "123@g.us", "whatsapp:15551234567@c.us")).status, status);
    const client = { getChatById: async () => ({ isGroup: true, addParticipants: async (people: string[], options: unknown) => {
      assert.deepEqual(options, { autoSendInviteV4: false }); return { [people[0]]: { code: Number(code) } };
    } }) };
    assert.equal((await addWebGroupMember(client, "123@g.us", "whatsapp:15551234567@c.us")).status, status);
  });
}
test("WhatsApp rejects wrong destinations, verifies target results and preserves private LIDs", async () => {
  let additions = 0;
  const sock = { groupMetadata: async () => ({ participants: [{ id: "77@lid", phoneNumber: "15551234567@s.whatsapp.net" }] }), groupParticipantsUpdate: async () => { additions++; return [{ jid: "wrong@s.whatsapp.net", status: "200" }]; } };
  assert.equal((await addBaileysGroupMember(sock, "123@g.us", "whatsapp:77@lid")).status, "already_member");
  assert.equal((await addBaileysGroupMember(sock, "123@g.us", "whatsapp:15551234567@c.us")).status, "already_member");
  assert.equal((await addBaileysGroupMember(sock, "123@g.us", "whatsapp:88@lid")).status, "not_added");
  assert.equal(additions, 0);
  assert.equal((await addBaileysGroupMember(sock, "123@g.us", "whatsapp:15551234568@c.us")).status, "unknown");
  await assert.rejects(addBaileysGroupMember(sock, "15551234567@s.whatsapp.net", "whatsapp:77@lid"), /group/);
});

function telegramFixture(supergroup = false, existing = false, missing = false) {
  const group = supergroup ? new Api.Channel({ id: bigInt(1), title: "Fixture", photo: new Api.ChatPhotoEmpty(), date: 0, megagroup: true }) : new Api.Chat({ id: bigInt(1), title: "Fixture", photo: new Api.ChatPhotoEmpty(), participantsCount: 1, date: 0, version: 1 });
  const user = new Api.User({ id: bigInt(2), firstName: "Fixture" });
  let adds = 0;
  const client = { getEntity: async (target: unknown) => typeof target === "number" ? user : group,
    invoke: async (request: any) => {
      if (request instanceof Api.messages.GetFullChat) return { fullChat: { participants: { participants: (existing || (adds > 0 && !missing)) ? [{ userId: user.id }] : [] } } };
      if (request instanceof Api.channels.GetParticipant) { if (existing || (adds > 0 && !missing)) return { participant: { className: "ChannelParticipant" } }; throw { errorMessage: "USER_NOT_PARTICIPANT" }; }
      assert.ok(supergroup ? request instanceof Api.channels.InviteToChannel : request instanceof Api.messages.AddChatUser);
      if (!supergroup) assert.equal(request.fwdLimit, 0);
      adds++;
      return { updates: new Api.UpdatesTooLong(), missingInvitees: missing ? [{ userId: user.id }] : [] };
    },
  };
  return { client, group, adds: () => adds };
}
for (const supergroup of [false, true]) {
  for (const [existing, missing, status] of [[false, false, "added"], [true, false, "already_member"], [false, true, "not_added"]] as const) {
    test(`Telegram ${supergroup ? "supergroup" : "basic group"}: ${status}`, async () => {
      const fixture = telegramFixture(supergroup, existing, missing);
      assert.equal((await addTelegramGroupMember(fixture.client, Api, {}, "telegram:2")).status, status);
      assert.equal(fixture.adds(), existing ? 0 : 1);
    });
  }
}
test("Telegram rejects channels/direct chats and maps permissions/privacy/rate limits honestly", async () => {
  const fixture = telegramFixture(true);
  fixture.group.broadcast = true;
  await assert.rejects(addTelegramGroupMember(fixture.client, Api, {}, "telegram:2"), /not a channel/);
  assert.equal(fixture.adds(), 0);
  for (const code of ["CHAT_ADMIN_REQUIRED", "USER_PRIVACY_RESTRICTED", "FLOOD_WAIT_20", "USERS_TOO_MUCH"]) assert.equal(membershipError({ errorMessage: code }).status, "not_added");
  assert.equal(membershipError(new Error("timeout")).status, "unknown");
});
