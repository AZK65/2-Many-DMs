import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppReceiveLogger, WhatsAppReceiveHealth } from "./whatsapp-receive-health";
import { decryptMessageNode, proto } from "@whiskeysockets/baileys";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";
const frame = (id: string, type = "msg") => ({ attrs: { id }, content: [{ tag: "enc", attrs: { type } }] });

test("a quiet connected account never triggers receive recovery", () => {
  const health = new WhatsAppReceiveHealth(() => 1_000_000);
  assert.equal(health.snapshot().stalled, false);
});
test("outgoing echoes cannot disguise a stuck received message", () => {
  let now = 1;
  const health = new WhatsAppReceiveHealth(() => now);
  health.receive(frame("incoming"));
  now += 90_001;
  health.receive(frame("outgoing"));
  health.upsert({ key: { id: "outgoing", fromMe: true }, message: {} }, 2);
  assert.equal(health.snapshot().stalled, true);
  assert.equal(health.snapshot().pendingCount, 1);
  health.upsert({ key: { id: "incoming", fromMe: false }, message: {} }, 2);
  assert.equal(health.snapshot().stalled, false);
  assert.equal(health.snapshot().inboundCount, 1);
});
test("repeated frames preserve the original deadline and completed messages stay settled", () => {
  let now = 1;
  const health = new WhatsAppReceiveHealth(() => now);
  health.receive(frame("same")); now += 80_000; health.receive(frame("same")); now += 11_000;
  assert.equal(health.snapshot().stalled, true);
  health.upsert({ key: { id: "same" }, messageStubType: 2 }, 2);
  health.receive(frame("same"));
  assert.equal(health.snapshot().pendingCount, 0);
  assert.equal(health.snapshot().decryptFailureCount, 1);
});
test("unavailable/control/unsupported frames do not cause reconnect loops", () => {
  let now = 1;
  const health = new WhatsAppReceiveHealth(() => now);
  health.receive({ attrs: { id: "control" }, content: [] });
  health.receive(frame("unsupported", "msmsg"));
  now += 999_999;
  assert.equal(health.snapshot().stalled, false);
  assert.equal(health.snapshot().unsupportedCount, 1);
});
test("the worker sees an open socket with a stuck receive queue as unhealthy", () => {
  let now = 1;
  const health = new WhatsAppReceiveHealth(() => now);
  health.receive(frame("stuck")); now += 90_001;
  const adapter = Object.assign(Object.create(WhatsAppBaileysAdapter.prototype), { state: "ready", detail: "Connected", sock: { ws: { isOpen: true } }, historyRequests: new Map(), receiveHealth: health }) as WhatsAppBaileysAdapter;
  assert.equal(adapter.getStatus().state, "disconnected");
  assert.match(adapter.getStatus().detail!, /Incoming WhatsApp/);
  health.upsert({ key: { id: "stuck" }, message: {} }, 2);
  assert.equal(adapter.getStatus().state, "ready", "late progress avoids an unnecessary reconnect");
});

test("Baileys decryption rejection is settled without an upsert or reconnect loop", async () => {
  let now = 1;
  const health = new WhatsAppReceiveHealth(() => now);
  const node = { attrs: { id: "rejected", from: "111@s.whatsapp.net", t: "1" },
    tag: "message", content: [{ tag: "enc", attrs: { type: "msg" }, content: Buffer.from([1]) }] };
  health.receive(node);
  const logger = createWhatsAppReceiveLogger(id => health.decryptionFailed(id));
  const decoded = decryptMessageNode(node, "222@s.whatsapp.net", "", {
    decryptMessage: async () => { throw Error("Key used already or never filled"); },
  } as any, logger as any);
  await decoded.decrypt();
  assert.equal(decoded.fullMessage.messageStubType, proto.WebMessageInfo.StubType.CIPHERTEXT);
  now += 90_001;
  assert.equal(health.snapshot().stalled, false);
  assert.equal(health.snapshot().recentUnresolvedDecryptions, 1);
  health.upsert(decoded.fullMessage, proto.WebMessageInfo.StubType.CIPHERTEXT);
  assert.equal(health.snapshot().decryptFailureCount, 1, "logger and stub must not double-count a failure");
  health.upsert({ key: { id: "rejected", fromMe: false }, message: {} }, 2);
  assert.equal(health.snapshot().recentUnresolvedDecryptions, 0, "a successful retry settles the failure");
  assert.equal(health.snapshot().inboundCount, 1);
});

test("receive logger ignores unrelated errors and child loggers retain the observer", () => {
  const ids: string[] = [];
  const logger = createWhatsAppReceiveLogger(id => ids.push(id));
  logger.error({ key: { id: "ignore" } }, "unrelated");
  logger.error(null, "failed to decrypt message");
  logger.child().error({ key: { id: "failed" }, err: { secret: "must not be logged" } }, "failed to decrypt message");
  assert.deepEqual(ids, ["failed"]);
});

test("bounded tracking retains the oldest stalled frame during a flood", () => {
  let now = 1;
  const health = new WhatsAppReceiveHealth(() => now);
  health.receive(frame("oldest"));
  now += 90_001;
  for (let i = 0; i < 2100; i++) health.receive(frame(`new-${i}`));
  assert.equal(health.snapshot().pendingCount, 2000);
  assert.equal(health.snapshot().stalled, true);
  health.upsert({ key: { id: "oldest" }, message: {} }, 2);
  assert.equal(health.snapshot().stalled, false);
});
