import assert from "node:assert/strict";
import { test } from "node:test";
import { MediaRecoveryQueue } from "./media-recovery";

test("foreground and background recovery share the real operation lock", async () => {
  const queue = new MediaRecoveryQueue(Date.now, async () => {});
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run("a", true, async () => { calls.push("a"); await gate; });
  assert.equal(queue.run("a", false, async () => { calls.push("duplicate"); }), first);
  const second = queue.run("b", true, async () => { calls.push("b"); });
  await Promise.resolve();
  assert.deepEqual(calls, ["a"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["a", "b"]);
});

test("flood waits block all media jobs, including manual retry, for Telegram's full interval", async () => {
  let now = 1000, calls = 0;
  const queue = new MediaRecoveryQueue(() => now, async () => {});
  await assert.rejects(queue.run("a", true, async () => { throw Object.assign(Error("FLOOD_WAIT_120"), { seconds: 120 }); }));
  await assert.rejects(queue.run("b", false, async () => { calls++; }), /pause downloads/);
  now += 120_001;
  await queue.run("b", true, async () => { calls++; });
  assert.equal(calls, 1);
});

test("failed files back off, while explicit retry remains possible without a flood wait", async () => {
  const queue = new MediaRecoveryQueue(Date.now, async () => {});
  let calls = 0;
  const fail = async () => { calls++; throw Error("gone"); };
  await assert.rejects(queue.run("a", true, fail));
  await assert.rejects(queue.run("a", true, fail));
  assert.equal(calls, 1);
  await queue.run("a", false, async () => { calls++; });
  assert.equal(calls, 2);
});
