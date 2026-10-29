import assert from "node:assert/strict";
import { test } from "node:test";
import { directRecipientIds, preserveDirectIdentity } from "./direct-contact-identity";

test("both phone JID spellings resolve to the same canonical recipient", () => {
  assert.deepEqual(directRecipientIds("whatsapp", "whatsapp:123456789@s.whatsapp.net"), ["123456789@c.us", "123456789@s.whatsapp.net"]);
  assert.deepEqual(directRecipientIds("whatsapp", "123456789:8@c.us"), ["123456789@c.us", "123456789@s.whatsapp.net"]);
});
test("a LID stays opaque unless WhatsApp explicitly supplies a phone alias", () => {
  assert.deepEqual(directRecipientIds("whatsapp", "39548193095901@lid"), ["39548193095901@lid"]);
  assert.deepEqual(directRecipientIds("whatsapp", "39548193095901@lid", ["123456789@s.whatsapp.net", "123@g.us"]),
    ["39548193095901@lid", "123456789@c.us", "123456789@s.whatsapp.net"]);
});
test("opening a group member DM cannot replace their saved identity with a generic fallback", () => {
  assert.deepEqual(preserveDirectIdentity({name:"Léo",handle:"Léo"}, {name:"WhatsApp member",handle:"WhatsApp member"}), {name:"Léo",handle:"Léo"});
  assert.deepEqual(preserveDirectIdentity({name:"My saved contact",handle:"+123456789"}, {name:"Leo",handle:"Leo"}), {name:"My saved contact",handle:"+123456789"});
});
test("an already damaged placeholder can be repaired from exact sender evidence", () => {
  assert.deepEqual(preserveDirectIdentity({name:"WhatsApp member",handle:"WhatsApp member"}, {name:"Léo",handle:"Léo"}), {name:"Léo",handle:"Léo"});
});
