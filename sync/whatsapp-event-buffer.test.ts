import assert from "node:assert/strict";
import test from "node:test";
import { makeEventBuffer } from "@whiskeysockets/baileys";
import { drainWhatsAppEvents } from "./whatsapp-event-buffer";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";

test("live Baileys events are released once, including after initial history sync", async () => {
  const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
  const ev = makeEventBuffer(logger as never);
  const socket = { ws: { isOpen: true }, ev };
  const received: string[] = [];
  ev.on("messages.upsert", ({ messages }) => { received.push(...messages.map(m => m.key.id!)); });
  const receive = ev.createBufferedFunction(async (id: string) => {
    ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id, remoteJid: "fixture@s.whatsapp.net" }, message: { conversation: "Fixture" } }] });
  });
  await receive("first");
  assert.equal(drainWhatsAppEvents(socket, 1, 10_000), false, "allow initial consolidation");
  drainWhatsAppEvents(socket, 1, 21_000);
  assert.deepEqual(received, ["first"]);
  await receive("second");
  drainWhatsAppEvents(socket, 1, 22_000);
  drainWhatsAppEvents(socket, 1, 23_000);
  assert.deepEqual(received, ["first", "second"], "each received message is delivered once");
  await receive("third");
  socket.ws.isOpen = false;
  assert.equal(drainWhatsAppEvents(socket, 1, 24_000), false);
  assert.deepEqual(received, ["first", "second"]);
});

test("a closed Baileys socket cannot report connected or bypass automatic recovery", () => {
  const adapter = Object.assign(Object.create(WhatsAppBaileysAdapter.prototype), {
    state: "ready", sock: { ws: { isOpen: false } }, historyRequests: new Map(),
  }) as WhatsAppBaileysAdapter;
  assert.equal(adapter.getStatus().state, "disconnected");
  assert.match(adapter.getStatus().detail!, /reconnecting/);
});
