import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { TelegramAdapter } from "./adapters/telegram";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-recovery-test-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const handlers: Array<(event: any) => Promise<void> | void> = [];
  const calls = { connect: 0, disconnect: 0, authorize: 0, dialogs: 0 };
  const client = {
    connected: false,
    async connect() { calls.connect++; this.connected = true; },
    async disconnect() { calls.disconnect++; this.connected = false; },
    async getMe() { calls.authorize++; return { id: 1, username: "test_account" }; },
    addEventHandler(callback: typeof handlers[number]) { handlers.push(callback); },
    async getDialogs() { calls.dialogs++; return []; },
  };
  const adapter = new TelegramAdapter(1, "test", "", "test-account") as any;
  adapter.client = client;
  adapter.ingestMessage = async (_chat: unknown, message: unknown, save: (message: unknown) => Promise<void>) => save(message);
  const saved: unknown[] = [], reads: string[] = [], reactions: unknown[] = [];
  const start = () => adapter.start(async (message: unknown) => { saved.push(message); },
    async (id: string) => { reads.push(id); }, async (reaction: unknown) => { reactions.push(reaction); });
  const message = { id: 42, isPrivate: true, getChat: async () => ({ id: 9 }) };
  t.after(async () => {
    await adapter.stop();
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { adapter, client, calls, handlers, start, message, saved, reads, reactions };
}

test("failed initial connection recovers live messages, reads, reactions and history", async t => {
  const f = fixture(t);
  const connect = f.client.connect.bind(f.client);
  f.client.connect = async () => { throw new Error("Network unavailable"); };
  await assert.rejects(f.start(), /Network unavailable/);
  assert.equal(f.adapter.getStatus().state, "disconnected");
  assert.equal(f.handlers.length, 0);
  assert.equal(f.adapter.historySync, undefined);
  f.client.connect = connect;
  await f.adapter.recover();
  assert.equal(f.adapter.getStatus().state, "ready");
  assert.equal(f.adapter.getStatus().detail, "@test_account");
  assert.ok(f.adapter.getStatus().sync);
  assert.equal(f.calls.dialogs, 1);
  await f.handlers[0]({ message: f.message });
  await f.handlers[1]({ className: "UpdateReadHistoryInbox", peer: { userId: 9 } });
  await f.handlers[2]({ className: "UpdateMessageReactions", peer: { userId: 9 }, msgId: 42,
    reactions: { results: [{ reaction: { emoticon: "👍" }, count: 1 }] } });
  assert.deepEqual(f.saved, [f.message]);
  assert.deepEqual(f.reads, ["9"]);
  assert.equal(f.reactions.length, 1);
});

test("authorization failure with an open socket is not reported as connected", async t => {
  const f = fixture(t);
  const getMe = f.client.getMe;
  f.client.getMe = async () => { throw new Error("Authorization check failed"); };
  await assert.rejects(f.start(), /Authorization check failed/);
  assert.equal(f.client.connected, true);
  assert.equal(f.adapter.getStatus().state, "disconnected");
  assert.equal(f.handlers.length, 0);
  f.client.getMe = getMe;
  await f.adapter.ensureReady();
  assert.equal(f.adapter.getStatus().state, "ready");
  assert.equal(f.calls.connect, 1);
  assert.equal(f.handlers.length, 3);
});

test("repeated recovery keeps one listener set, history scheduler and checkpoint owner", async t => {
  const f = fixture(t);
  await f.start();
  const history = f.adapter.historySync, timer = f.adapter.historyTimer;
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.adapter.recover();
    assert.equal(f.adapter.historySync, history);
    assert.equal(f.adapter.historyTimer, timer);
  }
  await f.start();
  assert.equal(f.handlers.length, 3);
  assert.equal(f.calls.connect, 4);
  assert.equal(f.calls.dialogs, 4);
  for (const handler of f.handlers) await handler({ message: f.message });
  assert.deepEqual(f.saved, [f.message], "one live update must be ingested exactly once");
});

test("concurrent startup, sends and recovery share full initialization, not just connect", async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.client.getMe = async () => { f.calls.authorize++; entered.resolve(); await gate.promise; return { id: 1, username: "test_account" }; };
  const start = f.start();
  await entered.promise;
  const pending = [f.adapter.ensureReady(), f.adapter.recover(), f.start()];
  assert.equal(f.client.connected, true);
  assert.equal(f.adapter.getStatus().state, "starting");
  assert.equal(f.handlers.length, 0);
  gate.resolve();
  await Promise.all([start, ...pending]);
  assert.equal(f.calls.connect, 1);
  assert.equal(f.calls.authorize, 1);
  assert.equal(f.calls.disconnect, 0);
  assert.equal(f.handlers.length, 3);
  assert.equal(f.adapter.getStatus().state, "ready");
});

test("stop during initialization cannot resurrect the connector or install timers", async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.client.getMe = async () => { entered.resolve(); await gate.promise; return { id: 1, username: "test_account" }; };
  const starting = f.start();
  const rejected = assert.rejects(starting, /stopped/);
  await entered.promise;
  const stopping = f.adapter.stop();
  assert.equal(f.adapter.getStatus().state, "disabled");
  gate.resolve();
  await Promise.all([rejected, stopping]);
  assert.equal(f.client.connected, false);
  assert.equal(f.handlers.length, 0);
  assert.equal(f.adapter.historyTimer, undefined);
  await assert.rejects(f.adapter.recover(), /stopped/);
});

test("a socket drop clears readiness until authenticated message sync resumes", async t => {
  const f = fixture(t);
  await f.start();
  f.client.connected = false;
  assert.equal(f.adapter.getStatus().state, "starting");
  assert.match(f.adapter.getStatus().detail, /Reconnecting/);
  f.client.connected = true; // GramJS's own reconnect does not complete app setup.
  assert.equal(f.adapter.getStatus().state, "starting");
  await f.adapter.ensureReady();
  assert.equal(f.adapter.getStatus().state, "ready");
  assert.equal(f.adapter.getStatus().detail, "@test_account");
  assert.equal(f.calls.authorize, 2);
  assert.equal(f.handlers.length, 3);
});

test("empty authorization result never becomes ready", async t => {
  const f = fixture(t);
  f.client.getMe = async () => undefined as any;
  await assert.rejects(f.start(), /session expired/);
  assert.equal(f.adapter.getStatus().state, "disconnected");
  assert.match(f.adapter.getStatus().detail, /Session expired.*reconnect/);
  assert.equal(f.handlers.length, 0);
});

test("recovery can retry after multiple failures without losing startup callbacks", async t => {
  const f = fixture(t);
  const connect = f.client.connect.bind(f.client);
  f.client.connect = async () => { throw new Error("Connection dropped"); };
  await assert.rejects(f.start(), /Connection dropped/);
  await assert.rejects(f.adapter.recover(), /Connection dropped/);
  await assert.rejects(f.adapter.recover(), /Connection dropped/);
  f.client.connect = connect;
  await f.adapter.recover();
  await f.handlers[0]({ message: f.message });
  assert.deepEqual(f.saved, [f.message]);
  assert.equal(f.adapter.getStatus().detail, "@test_account");
});

test("stopped listeners cannot persist messages or restart a removed account", async t => {
  const f = fixture(t);
  await f.start();
  await f.adapter.stop();
  for (const handler of f.handlers) await handler({ message: f.message });
  assert.deepEqual(f.saved, []);
  await assert.rejects(f.start(), /stopped/);
  assert.equal(f.adapter.onMessage, undefined);
});
