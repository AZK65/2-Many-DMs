import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { XMautrixAdapter } from "./adapters/x-mautrix";
import { XHybridAdapter } from "./adapters/x-hybrid";
import { MautrixError, type MautrixEvent, type MautrixRPC } from "./x-mautrix-process";
import type { InboundMessage } from "./adapters/types";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function fixture(t: any, custom?: (method: string, args: any) => Promise<any>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mautrix-test-"));
  const checkpoint = path.join(directory, "checkpoint.json");
  const messages: InboundMessage[] = [];
  const calls: { method: string; args: any }[] = [];
  let emit!: (event: MautrixEvent) => Promise<void>;
  const rpc: MautrixRPC = { request: async <T>(method: string, args?: any) => {
    calls.push({ method, args });
    if (method === "start") return { userId: "100" } as T;
    if (method === "unlock") return { ready: true } as T;
    if (method === "inbox") return { maxSequence: "500", cursor: { pull_finished: true } } as T;
    if (custom) return custom(method, args);
    throw new Error(`Unexpected ${method}`);
  }, stop: async () => {} };
  const adapter = new XMautrixAdapter({ accountId: "fixture", session: { authToken: "synthetic", ct0: "synthetic" }, checkpoint, rpcFactory: event => { emit = event; return rpc; } });
  t.after(async () => { await adapter.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await adapter.start(async m => { messages.push(m); });
  await adapter.unlockChat("0000");
  await emit({ event: "conversation", conversation: { conversation_id: "100:200", participants_results: [{ rest_id: "200", result: { core: { name: "Test Person", screen_name: "test" } } }] } });
  return { adapter, emit, calls, messages, checkpoint };
}

test("live receipt and confirmed send finish while an older history request remains blocked", async t => {
  const history = deferred<any>();
  const f = await fixture(t, async (method, args) => method === "history" ? history.promise : { messageId: args.messageId, timestamp: "1790000000000" });
  const backfill = f.adapter.restoreNext();
  const nativeId = "352be8ea-7208-486c-93b5-f921e4469268";
  await f.emit({ event: "message", nativeId, historical: false, message: { conversation_id: "100:200", id: "900", time: "1790000000000", message_data: { sender_id: "200", text: "Live while restoring" } } });
  assert.equal(f.messages[0].messageExternalId, `x:${nativeId}`);
  assert.equal(f.messages[0].chatExternalId, "100-200");
  assert.equal(f.messages[0].historical, false);
  const receipt = await f.adapter.send("100-200", "Synthetic send");
  assert.match(receipt.messageExternalId, /^x:[\da-f-]{36}$/);
  assert.equal(f.calls.find(c => c.method === "send")!.args.conversation, "100:200");
  assert.equal(f.adapter.getStatus().sync?.pendingChats, 1);
  history.resolve({ cursor: "600", count: 25, hasMore: true }); await backfill;
  assert.equal(JSON.parse(fs.readFileSync(f.checkpoint, "utf8")).jobs[0][1].cursor, "600");
});

test("failed and repeating history pages retain their checkpoint and retry instead of declaring completion", async t => {
  const f = await fixture(t, async () => { throw new MautrixError("rate_limited", "history"); });
  await f.adapter.restoreNext();
  const saved = JSON.parse(fs.readFileSync(f.checkpoint, "utf8"));
  assert.equal(saved.jobs[0][1].cursor, "");
  assert.equal(saved.completed.length, 0);
  assert.equal(f.adapter.getStatus().sync?.blockedChats, 1);
});

test("opening a chat fetches its newest window without resetting older history", async t => {
  let n = 0;
  const f = await fixture(t, async () => ({ cursor: ++n === 1 ? "600" : "950", count: 25, hasMore: true }));
  await f.adapter.restoreNext();
  f.adapter.refreshRecent("100-200"); await f.adapter.restoreNext();
  const history = f.calls.filter(c => c.method === "history");
  assert.equal(history[1].args.cursor, "");
  assert.equal(JSON.parse(fs.readFileSync(f.checkpoint, "utf8")).jobs[0][1].cursor, "600");
});

test("completed chats are not requeued by another inbox snapshot", async t => {
  const f = await fixture(t, async () => ({ cursor: "10", count: 1, hasMore: false }));
  await f.adapter.restoreNext();
  await f.emit({ event: "conversation", conversation: { conversation_id: "100:200" } });
  assert.equal(f.adapter.getStatus().sync?.pendingChats, 0);
});

test("latest inbox checks do not wait for or replace the older inbox continuation", async t => {
  const f = await fixture(t);
  const older = { cursor: { cursor_id: "old-page", graph_snapshot_id: "old-snapshot" } };
  (f.adapter as any).inboxContinuation = older;
  await (f.adapter as any).refreshInbox();
  assert.deepEqual(f.calls.filter(c => c.method === "inbox").at(-1)?.args, { cursor: "500" });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.checkpoint, "utf8")).continuation, older);
});

test("photo downloads do not delay live message storage or sends", async t => {
  const media = deferred<any>();
  const f = await fixture(t, async method => method === "media" ? media.promise : { messageId: "confirmed", timestamp: "1790000000000" });
  await f.emit({ event: "message", nativeId: "photo-fixture", message: { conversation_id: "100:200", time: "1790000000000", message_data: { sender_id: "200", attachment: { photo: { media_hash_key: "synthetic" } } } } });
  assert.equal(f.messages[0].media?.type, "image");
  assert.equal(f.messages[0].media?.url, null);
  assert.equal((await f.adapter.send("100-200", "Text")).messageExternalId, "x:confirmed");
  media.reject(new Error("Synthetic missing file"));
});

test("recent history continues promptly while older pages use a slower bounded pace", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_790_000_000_000 });
  let cursor = 800;
  const f = await fixture(t, async () => ({ cursor: String(cursor -= 100), count: 25, hasMore: true }));
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(0); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 1);
  t.mock.timers.tick(499); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 1);
  t.mock.timers.tick(1); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 2);
  t.mock.timers.tick(2999); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 2);
  t.mock.timers.tick(1); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 3);
});

test("faster scheduling keeps rate-limit cooldowns and does not report failed pages as progress", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_790_000_000_000 });
  const f = await fixture(t, async () => { throw new MautrixError("rate_limited", "history"); });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(0); await flush();
  assert.equal(f.adapter.getStatus().sync?.history?.pagesFetched, 0);
  t.mock.timers.tick(59_999); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 1);
  t.mock.timers.tick(1); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 2);
  t.mock.timers.tick(119_999); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 2);
  const checkpoint = JSON.parse(fs.readFileSync(f.checkpoint, "utf8"));
  assert.equal(checkpoint.rateLimitLevel, 2);
  assert.equal(checkpoint.retryAt, 1_790_000_180_000);
  t.mock.timers.tick(1); await flush();
  assert.equal(f.calls.filter(c => c.method === "history").length, 3);
});

test("newer chats load first and recent progress advances before entire histories finish", async t => {
  const f = await fixture(t, async () => ({ cursor: "600", count: 25, hasMore: true }));
  await f.emit({ event: "conversation", conversation: { conversation_id: "100:300" } });
  await f.emit({ event: "message", nativeId: "newer", historical: true,
    message: { conversation_id: "100:300", time: "1790000000000", message_data: { sender_id: "300", text: "Newest chat" } } });
  await f.adapter.restoreNext();
  assert.equal(f.calls.filter(c => c.method === "history")[0].args.conversation, "100:300");
  const sync = f.adapter.getStatus().sync!;
  assert.equal(sync.pendingChats, 2);
  assert.equal(sync.history?.recentReady, 1);
  assert.equal(sync.history?.recentPending, 1);
  assert.equal(sync.history?.olderPending, 1);
  assert.equal(sync.history?.completed, 0);
  assert.equal(sync.history?.pagesFetched, 1);
});

test("older pages rotate between chats and discovery instead of waiting for the whole inbox", async t => {
  const f = await fixture(t, async (_method, args) => ({ cursor: args.cursor ? "400" : "600", count: 25, hasMore: true }));
  await f.emit({ event: "conversation", conversation: { conversation_id: "100:300" } });
  await f.adapter.restoreNext(); await f.adapter.restoreNext();
  (f.adapter as any).inboxContinuation = { cursor: { cursor_id: "old-page", graph_snapshot_id: "snapshot" } };
  const offset = f.calls.length;
  await f.adapter.restoreNext(); await f.adapter.restoreNext(); await f.adapter.restoreNext();
  assert.deepEqual(f.calls.slice(offset).map(c => [c.method, c.args.conversation]), [["history", "100:200"], ["inbox", undefined], ["history", "100:300"]]);
});

test("an explicit older-history request takes priority without resetting its cursor", async t => {
  const f = await fixture(t, async (_method, args) => ({ cursor: args.cursor ? "400" : "600", count: 25, hasMore: true }));
  await f.adapter.restoreNext();
  await f.emit({ event: "conversation", conversation: { conversation_id: "100:300" } });
  await f.adapter.requestHistory("100-200");
  await f.adapter.restoreNext();
  assert.deepEqual(f.calls.filter(c => c.method === "history").at(-1)?.args, { conversation: "100:200", cursor: "600" });
});

function fakeConnector(overrides: any = {}) {
  return { platform: "x" as const, start: async () => {}, stop: async () => {}, send: async () => ({ messageExternalId: "x:confirmed", timestamp: new Date().toISOString() }), unlockChat: async () => ({ state: "unlocked" as const, updatedAt: Date.now() }), getStatus: () => ({ platform: "x" as const, state: "ready" as const }), ...overrides };
}

test("fallback starts only after primary shutdown, never alongside it", async () => {
  const stopped = deferred<void>(); const order: string[] = [];
  const adapter = new XHybridAdapter({ accountId: "fixture", primary: fakeConnector({ stop: async () => { order.push("stopping"); await stopped.promise; order.push("stopped"); } }), browserFactory: () => fakeConnector({ start: async () => { order.push("browser"); } }) });
  await adapter.start(async () => {});
  const switching = adapter.useBrowser();
  assert.deepEqual(order, ["stopping"]);
  stopped.resolve(); await switching;
  assert.deepEqual(order, ["stopping", "stopped", "browser"]);
  await adapter.stop();
});

test("an uncertain primary send is never replayed by the browser fallback", async () => {
  let primarySends = 0, browserSends = 0;
  const adapter = new XHybridAdapter({ accountId: "fixture", primary: fakeConnector({ send: async () => { primarySends++; throw new MautrixError("timeout", "send", true); } }), browserFactory: () => fakeConnector({ send: async () => { browserSends++; return { messageExternalId: "x:second", timestamp: new Date().toISOString() }; } }) });
  await adapter.start(async () => {});
  await assert.rejects(adapter.send("100-200", "Do not replay"), /waiting for X acceptance failed/);
  await adapter.useBrowser();
  assert.equal(primarySends, 1); assert.equal(browserSends, 0);
  await adapter.send("100-200", "A separate later message"); assert.equal(browserSends, 1);
  await adapter.stop();
});

test("fallback waits for a send already in flight without retrying it", async () => {
  const send = deferred<any>(); let stopped = false;
  const adapter = new XHybridAdapter({ accountId: "fixture", primary: fakeConnector({ send: () => send.promise, stop: async () => { stopped = true; } }), browserFactory: () => fakeConnector() });
  await adapter.start(async () => {});
  const sending = adapter.send("100-200", "In flight"); const switching = adapter.useBrowser();
  assert.equal(stopped, false);
  send.resolve({ messageExternalId: "x:confirmed", timestamp: new Date().toISOString() });
  await sending; await switching; assert.equal(stopped, true); await adapter.stop();
});

test("a ready fallback can send while its initial history scan is still running", async () => {
  const history = deferred<void>();
  const adapter = new XHybridAdapter({ accountId: "fixture", primary: fakeConnector(), browserFactory: () => fakeConnector({ start: () => history.promise }) });
  await adapter.start(async () => {});
  const switching = adapter.useBrowser();
  await Promise.resolve();
  assert.equal(adapter.getStatus().state, "ready");
  assert.equal((await adapter.send("100-200", "Live during browser restore")).messageExternalId, "x:confirmed");
  history.resolve(); await switching; await adapter.stop();
});
