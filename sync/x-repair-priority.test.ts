import assert from "node:assert/strict";
import test from "node:test";
import { nextXRepair, needsXRecentHistory, xRepairLatest, type XRepairPriority } from "./x-repair-priority";

const now = Date.parse("2026-11-26T15:00:00Z");
const day = 86400000;
const job = (age: number, body = "hello"): XRepairPriority => ({ activityAt: now - age, previewKey: `in:${body}:${now - age}`, attempts: 0 });

test("all active recent windows precede deep history and old attachments, newest first", () => {
  const old = { ...job(30 * day), imageRecovery: true };
  const yesterday = job(day), newest = job(1000);
  const queue = new Map([['old', old], ['yesterday', yesterday], ['newest', newest]]);
  const retries = new Map([['newest', now + day]]); // old attachment cooldown
  assert.equal(nextXRepair(queue, retries, now)?.key, 'newest');
  newest.recentKey = newest.previewKey;
  assert.equal(nextXRepair(queue, retries, now)?.key, 'yesterday');
  yesterday.recentKey = yesterday.previewKey;
  assert.deepEqual(nextXRepair(queue, retries, now), { key: 'yesterday', repair: yesterday, phase: 'history' });
  queue.delete('yesterday');
  assert.equal(nextXRepair(queue, retries, now)?.key, 'old');
});

test("recent checkpoints survive restarts but a new message requires a new recent window", () => {
  const repair = job(1000);
  repair.recentKey = repair.previewKey;
  const restored = JSON.parse(JSON.stringify(repair));
  assert.equal(needsXRecentHistory(restored, now), false);
  restored.previewKey = `in:new:${now}`;
  assert.equal(needsXRecentHistory(restored, now), true);
});

test("a failed recent chat waits without blocking other recent chats or retrying as deep history", () => {
  const newest = { ...job(1000), recentRetryAt: now + 300000 };
  const next = job(2000);
  const queue = new Map([['newest', newest], ['next', next]]);
  assert.equal(nextXRepair(queue, new Map(), now)?.key, 'next');
  queue.delete('next');
  assert.equal(nextXRepair(queue, new Map(), now), undefined);
  assert.equal(nextXRepair(queue, new Map(), now + 300001)?.key, 'newest');
});

test("deeper history works back from the newest chats and rotates failed work", () => {
  const a = job(day), b = job(2 * day), old = job(30 * day);
  a.recentKey = a.previewKey; b.recentKey = b.previewKey;
  const queue = new Map([['old', old], ['b', b], ['a', a]]);
  assert.equal(nextXRepair(queue, new Map(), now)?.key, 'a');
  a.attempts++;
  assert.equal(nextXRepair(queue, new Map(), now)?.key, 'b');
  queue.delete('b'); queue.delete('a');
  assert.equal(nextXRepair(queue, new Map(), now)?.key, 'old');
});

test("legacy preview proof retains URLs, multiline text and original event time", () => {
  const repair = job(1000, 'See https://example.com/a:b\nnext line');
  assert.deepEqual(xRepairLatest(repair), { direction: 'in', preview: 'See https://example.com/a:b\nnext line', timestamp: now - 1000 });
  assert.equal(xRepairLatest({ previewKey: 'unknown', attempts: 0 }), undefined);
});
