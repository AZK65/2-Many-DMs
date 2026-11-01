import assert from "node:assert/strict";
import { test } from "node:test";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TelegramAdapter } from "./adapters/telegram";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { DiscordBotAdapter } from "./adapters/discord";

test("Telegram verifies peer and authorship before native edits/deletions and does not parse link text", async () => {
  const adapter = Object.create(TelegramAdapter.prototype) as any;
  let native: any = { id: 456, out: true, peerId: new Api.PeerUser({ userId: bigInt(123) }) };
  const calls: any[] = [];
  Object.assign(adapter, { prioritizeOutbound: () => {}, ensureReady: async () => {},
    resolvePeer: async () => new Api.InputPeerUser({ userId: bigInt(123), accessHash: bigInt(1) }),
    client: { getMessages: async () => [native], editMessage: async (...args: any[]) => calls.push(["edit", ...args]),
      deleteMessages: async (...args: any[]) => calls.push(["delete", ...args]) } });
  await adapter.editMessage("123", "telegram:123:456", "hello https://example.com/a_b");
  assert.equal(calls[0][2].text, "hello https://example.com/a_b");
  assert.deepEqual(calls[0][2].formattingEntities, []);
  await adapter.deleteMessage("123", "telegram:123:456");
  assert.deepEqual(calls[1][3], { revoke: true });
  native = { ...native, peerId: new Api.PeerUser({ userId: bigInt(999) }) };
  await assert.rejects(adapter.deleteMessage("123", "telegram:123:456"), /verify/);
  native = { ...native, out: false };
  await assert.rejects(adapter.editMessage("123", "telegram:123:456", "not mine"), /verify/);
  assert.equal(calls.length, 2);
});

test("Baileys routes exact own-message keys, normalizes canonical chat IDs and requires a receipt", async () => {
  const adapter = Object.create(WhatsAppBaileysAdapter.prototype) as any;
  let key: any = { remoteJid: "123@s.whatsapp.net", id: "ABC123456", fromMe: true };
  const calls: any[] = [];
  Object.assign(adapter, { ensureReady: async () => {}, readMessage: () => ({ key }),
    sock: { sendMessage: async (...args: any[]) => { calls.push(args); return { key: { id: "receipt" } }; } } });
  await adapter.editMessage("123@c.us", "whatsapp:123@c.us:ABC123456", "edited");
  assert.equal(calls[0][0], "123@s.whatsapp.net");
  assert.deepEqual(calls[0][1], { text: "edited", edit: key });
  await adapter.deleteMessage("123@c.us", "whatsapp:123@c.us:ABC123456");
  assert.deepEqual(calls[1][1], { delete: key });
  key = { ...key, fromMe: false };
  await assert.rejects(adapter.deleteMessage("123@c.us", "whatsapp:123@c.us:ABC123456"), /verify/);
  assert.equal(calls.length, 2);
  key = { ...key, fromMe: true };
  adapter.sock.sendMessage = async () => undefined;
  await assert.rejects(adapter.deleteMessage("123@c.us", "whatsapp:123@c.us:ABC123456"), /confirm/);
});

test("WhatsApp Web never falls back to deleting only for me", async () => {
  const adapter = Object.create(WhatsAppAdapter.prototype) as any;
  const nativeId = "true_123@c.us_ABC123456";
  let canRevoke = true;
  let revoked = 0;
  const fake = { fromMe: true, to: "123@c.us", id: { _serialized: nativeId }, edit: async () => null };
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = { Store: {
    Msg: { get: () => ({ id: { fromMe: true, remote: "123@c.us" } }) },
    MsgActionChecks: { canSenderRevokeMsg: () => canRevoke }, Chat: { get: () => ({}) },
    Cmd: { sendRevokeMsgs: async () => { revoked++; }, sendDeleteMsgs: () => { throw new Error("Must never delete only locally"); } },
  }, Debug: { VERSION: "2.3000.0" }, compareWwebVersions: () => true };
  Object.assign(adapter, { ensureReady: async () => {}, client: { getMessageById: async () => fake,
    pupPage: { evaluate: async (fn: any, arg: any) => fn(arg) } } });
  try {
    await adapter.deleteMessage("123@c.us", `whatsapp:${nativeId}`);
    assert.equal(revoked, 1);
    canRevoke = false;
    await assert.rejects(adapter.deleteMessage("123@c.us", `whatsapp:${nativeId}`), /no longer allows/);
    await assert.rejects(adapter.editMessage("123@c.us", `whatsapp:${nativeId}`, "changed"), /did not accept/);
    assert.equal(revoked, 1);
  } finally { (globalThis as any).window = originalWindow; }
});

test("Discord bot changes require the original bot author in the exact allowed channel", async () => {
  const adapter = Object.create(DiscordBotAdapter.prototype) as any;
  const calls: any[] = [];
  let author = "111";
  Object.assign(adapter, { botUser: { id: "111" }, ensureReady: async () => {}, canUseChannel: () => true,
    request: async (path: string, init?: RequestInit) => {
      if (!init) return { author: { id: author }, channel_id: "222" };
      calls.push([path, init]); return {};
    } });
  await adapter.editMessage("222", "discord:222:333", "Changed");
  assert.equal(calls[0][1].method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0][1].body).allowed_mentions, { parse: [] });
  await adapter.deleteMessage("222", "discord:222:333");
  assert.equal(calls[1][1].method, "DELETE");
  author = "444";
  await assert.rejects(adapter.deleteMessage("222", "discord:222:333"), /Only messages/);
  assert.equal(calls.length, 2);
});
