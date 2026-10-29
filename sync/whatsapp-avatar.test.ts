import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";

test("WhatsApp photo retry uses only the exact group member's verified phone alias", async () => {
  const adapter = new WhatsAppBaileysAdapter({ clientId: "avatar-test" }) as any;
  adapter.state = "ready";
  const requested: string[] = [];
  let metadataCalls = 0;
  adapter.sock = { ws: { isOpen: true }, profilePictureUrl: async (jid: string) => {
    requested.push(jid); return undefined;
  }, groupMetadata: async () => { metadataCalls++; return { participants: [
    { id: "321@lid", jid: "33123456789@s.whatsapp.net" },
    { id: "999@lid", jid: "33999999999@s.whatsapp.net" },
  ] }; } };
  assert.deepEqual(await adapter.refreshAvatar("321@lid", false, { groupExternalId: "123@g.us" }), { source: "unavailable" });
  assert.deepEqual(requested, ["321@lid", "33123456789@s.whatsapp.net"]);
  requested.length = 0;
  await adapter.refreshAvatar("888@lid", false, { groupExternalId: "123@g.us" });
  assert.deepEqual(requested, ["888@lid"]);
  assert.equal(metadataCalls, 1, "reuse membership data instead of repeatedly querying the same group");
});

test("WhatsApp rate limits stop before alias retries", async () => {
  const adapter = new WhatsAppBaileysAdapter({ clientId: "avatar-test" }) as any;
  adapter.state = "ready";
  adapter.sock = { ws: { isOpen: true }, profilePictureUrl: async () => { throw { data: 429 }; },
    groupMetadata: () => assert.fail("do not bypass a rate limit using aliases") };
  await assert.rejects(adapter.refreshAvatar("321@lid", false, { groupExternalId: "123@g.us" }), error => (error as any).data === 429);
});
