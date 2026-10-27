import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageRetention, DurableRecords, canonicalWhatsAppMessage } from "./retention";
import type { InboundMessage } from "./adapters/types";

const message: InboundMessage = { platform: "telegram", accountId: "fixture-account", chatExternalId: "123", messageExternalId: "telegram:123:456", body: "private fixture", direction: "in", timestamp: new Date("2026-10-15T12:00:00Z"), media: { type: "image", url: null }, contact: { externalKey: "telegram:123", name: "Fixture", handle: "fixture" } };
function setup(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-retention-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("message DB failure survives restart and replays historically without losing dates", async t => {
  const dir = setup(t);
  const store = new MessageRetention(dir);
  await assert.rejects(store.save(message, async () => { throw Error("fixture DB unavailable"); }));
  const files = fs.readdirSync(path.join(dir, "incoming")).filter(f => f.endsWith(".enc"));
  assert.equal(files.length, 1);
  assert.ok(!fs.readFileSync(path.join(dir, "incoming", files[0]), "utf8").includes(message.body));
  assert.equal(fs.statSync(path.join(dir, "incoming", files[0])).mode & 0o777, 0o600);
  const restarted = new MessageRetention(dir);
  await restarted.replay(new Set([message.accountId!]), async m => {
    assert.equal(m.historical, true);
    assert.equal(m.timestamp.toISOString(), message.timestamp.toISOString());
    return "conversation";
  });
  assert.equal([...restarted.incoming.values()].length, 0);
  assert.equal([...restarted.media.values()].length, 1);
});

test("media retries keep backoff across restarts and repeated history, with one owner", async t => {
  const dir = setup(t);
  let now = 1000;
  const store = new MessageRetention(dir, () => now);
  store.enqueueMedia(message);
  let finish!: (ok: boolean) => void;
  let calls = 0;
  const pending = store.runOne(message.accountId!, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  await store.runOne(message.accountId!, async () => { calls++; return true; });
  assert.equal(calls, 1);
  finish(false);
  await pending;
  const restarted = new MessageRetention(dir, () => now);
  restarted.enqueueMedia(message);
  await restarted.runOne(message.accountId!, async () => { calls++; return true; });
  assert.equal(calls, 1);
  now += 120001;
  await restarted.runOne(message.accountId!, async () => { calls++; return true; });
  assert.equal(calls, 2);
  assert.equal([...restarted.media.values()].length, 0);
  restarted.enqueueMedia(message);
  assert.equal([...restarted.media.values()].length, 0);
});

test("an in-flight write cannot erase a newer failed update or be replayed prematurely", async t => {
  const store = new MessageRetention(setup(t));
  let finish!: (value: string) => void;
  const first = store.save(message, () => new Promise(resolve => { finish = resolve; }));
  await store.replay(new Set([message.accountId!]), async () => { assert.fail("live write replayed"); });
  await assert.rejects(store.save({ ...message, body: "newer update" }, async () => { throw Error("DB unavailable"); }));
  finish("conversation");
  await first;
  assert.equal([...store.incoming.values()][0].body, "newer update");
});

test("one stalled platform does not block another; disconnected accounts are not replayed", async t => {
  const store = new MessageRetention(setup(t));
  store.enqueueMedia(message);
  store.enqueueMedia({ ...message, accountId: "second" });
  let finish!: (ok: boolean) => void;
  const pending = store.runOne(message.accountId!, () => new Promise(resolve => { finish = resolve; }));
  let done = false;
  await store.runOne("second", async () => { done = true; return true; });
  assert.equal(done, true);
  finish(true); await pending;
  store.incoming.put("fixture", message);
  await store.replay(new Set(), async () => { assert.fail("wrong account replayed"); });
  assert.equal([...store.incoming.values()].length, 1);
});

test("switching WhatsApp engines retains web chat, message, sender and reply IDs", () => {
  const converted = canonicalWhatsAppMessage({ ...message, platform: "whatsapp", chatExternalId: "123@s.whatsapp.net", messageExternalId: "whatsapp:123@s.whatsapp.net:ABC", contact: { ...message.contact, externalKey: "whatsapp:123@s.whatsapp.net" }, sender: { externalKey: "whatsapp:456@s.whatsapp.net", name: "Sender" }, replyToExternalKey: "whatsapp:123@s.whatsapp.net:OLD" });
  assert.equal(converted.chatExternalId, "123@c.us");
  assert.equal(converted.messageExternalId, "whatsapp:123@c.us:ABC");
  assert.equal(converted.sender?.externalKey, "whatsapp:456@c.us");
  assert.equal(converted.replyToExternalKey, "whatsapp:123@c.us:OLD");
  assert.equal(canonicalWhatsAppMessage({ ...converted, chatExternalId: "123@g.us" }).chatExternalId, "123@g.us");
  assert.equal(canonicalWhatsAppMessage({ ...converted, chatExternalId: "123@lid" }).chatExternalId, "123@lid");
});

test("Baileys raw records survive restart without browser, metadata requests or media downloads", async t => {
  const { WhatsAppBaileysAdapter } = await import("./adapters/whatsapp-baileys");
  const dir = setup(t);
  const adapter = new WhatsAppBaileysAdapter({ clientId: "fixture" });
  Object.assign(adapter, { rawMessages: new DurableRecords<string>(dir) });
  const raw = { key: { remoteJid: "123@s.whatsapp.net", id: "ABC", fromMe: false }, messageTimestamp: 1792065600, pushName: "Fixture", message: { imageMessage: { caption: "picture", mimetype: "image/jpeg", mediaKey: Buffer.from("fixture-key") } } };
  const inbound = await (adapter as any).toInbound(raw, false);
  assert.equal(inbound.media.type, "image");
  assert.equal(inbound.media.url, null);
  const restarted = new WhatsAppBaileysAdapter({ clientId: "fixture" });
  Object.assign(restarted, { rawMessages: new DurableRecords<string>(dir) });
  const recovered = (restarted as any).readMessage("whatsapp:123@c.us:ABC");
  assert.equal(recovered.message.imageMessage.caption, "picture");
  assert.deepEqual(Buffer.from(recovered.message.imageMessage.mediaKey), Buffer.from("fixture-key"));
});
