import assert from "node:assert/strict";
import test from "node:test";
import { RecentChatRefresh } from "./recent-chat-refresh";

const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

test("chat switches coalesce, repeat opens deduplicate, and reads never overlap", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const q = new RecentChatRefresh({ ready: () => true, busy: () => false, retryAt: () => 0, intervalMs: 0,
    refresh: async ({ id }) => { calls.push(id); if (id === "b") await gate; }, onError: error => { throw error; } });
  try {
    q.request("a"); q.request("b"); q.request("b"); await tick();
    assert.deepEqual(calls, ["b"]);
    q.request("c"); q.request("b");
    assert.equal((q as any).target, undefined, "returning to the active chat cancels the previous selection");
    q.request("c"); q.request("d"); await tick();
    assert.deepEqual(calls, ["b"]);
    release(); await tick(); assert.deepEqual(calls, ["b", "d"]);
    q.request("d"); await tick(); assert.deepEqual(calls, ["b", "d"]);
    q.request("e"); q.stop(); await tick(); assert.deepEqual(calls, ["b", "d"]);
  } finally { release(); q.stop(); }
});

test("foreground reads respect account cooldowns and preserve the queued request", async () => {
  let calls = 0;
  const retryAt = Date.now() + 100;
  const q = new RecentChatRefresh({ ready: () => true, busy: () => false, retryAt: () => retryAt, intervalMs: 0,
    refresh: async () => { calls++; }, onError: error => { throw error; } });
  try {
    q.request("a"); await tick(30); assert.equal(calls, 0); assert.equal(q.pending, true);
    await tick(120); assert.equal(calls, 1); assert.equal(q.pending, false);
  } finally { q.stop(); }
});

test("a failed recent read releases ownership without automatic retry or falsely caching success", async () => {
  let calls = 0, errors = 0;
  const q = new RecentChatRefresh({ ready: () => true, busy: () => false, retryAt: () => 0, intervalMs: 0,
    refresh: async () => { calls++; throw Error("offline"); }, onError: () => { errors++; } });
  try {
    q.request("a"); await tick(); assert.equal(calls, 1); assert.equal(errors, 1); assert.equal(q.pending, false);
    await tick(); assert.equal(calls, 1);
    q.request("a"); await tick(); assert.equal(calls, 2);
  } finally { q.stop(); }
});
