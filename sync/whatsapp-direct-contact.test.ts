import assert from "node:assert/strict";
import { test } from "node:test";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";

function adapterWith(participant = "39548193095901@lid") {
  const adapter = new WhatsAppBaileysAdapter({clientId:"direct-contact-unit-test"});
  const state = adapter as any;
  state.state = "ready";
  state.readMessage = () => ({ key: {participant}, pushName:"Léo" });
  state.sock = { ws: {isOpen:true}, profilePictureUrl: async () => undefined,
    groupMetadata: async () => ({participants:[
      {id:"39548193095901@lid",lid:"39548193095901@lid",jid:"123456789@s.whatsapp.net"},
      {id:"999@lid",jid:"999999999@s.whatsapp.net"},
    ]}) };
  return adapter;
}
test("group DM lookup recovers the exact sender name and verified phone alias", async () => {
  const result = await adapterWith().resolveDirectContact("whatsapp:39548193095901@lid", {groupExternalId:"123@g.us",senderMessageExternalId:"known-message"});
  assert.equal(result.name, "Léo");
  assert.equal(result.handle, "+123456789");
  assert.deepEqual(result.aliases, ["39548193095901@lid","123456789@s.whatsapp.net"]);
});
test("a different sender's message cannot supply the requested member's name", async () => {
  const result = await adapterWith("999@lid").resolveDirectContact("39548193095901@lid", {senderMessageExternalId:"wrong-message"});
  assert.equal(result.name, "WhatsApp member");
  assert.equal(result.handle, "WhatsApp member");
  assert.deepEqual(result.aliases, ["39548193095901@lid"]);
});
test("missing group metadata does not prevent opening an exact known member", async () => {
  const adapter = adapterWith();
  (adapter as any).sock.groupMetadata = async () => { throw Error("unavailable"); };
  const result = await adapter.resolveDirectContact("39548193095901@lid", {groupExternalId:"123@g.us",senderMessageExternalId:"known-message"});
  assert.equal(result.name,"Léo");
  assert.equal(result.handle,"Léo");
});
