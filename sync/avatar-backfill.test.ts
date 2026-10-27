import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AvatarBackfill, avatarRetryDelay, type AvatarJob } from "./avatar-backfill";
import { avatarUnavailable } from "./avatar-errors";

const job: AvatarJob = { accountId: "a", contactId: "c", externalKey: "whatsapp:g", chatId: "g", isGroup: true, platform: "whatsapp", attempts: 0 };
test("avatar jobs deduplicate and resume without restarting an active pass", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-avatar-test-"));
  try {
    const file = path.join(dir, "jobs.json");
    const queue = new AvatarBackfill(file);
    assert.equal(queue.start([job, job, { ...job, contactId: "d", chatId: "d" }]).total, 2);
    assert.equal(queue.start([{ ...job, contactId: "e" }]).total, 2);
    await queue.runOne("a", async () => ({ source: "downloaded", url: "/avatars/a.jpg" }));
    const resumed = new AvatarBackfill(file);
    assert.equal(resumed.snapshot().pending, 1);
    assert.equal(resumed.snapshot().downloaded, 1);
    let called = false;
    await resumed.runOne("a", async () => { called = true; return { source: "unavailable" }; });
    assert.equal(called, false, "account pacing survives restarts");
    await resumed.runOne("a", async () => ({ source: "unavailable" }), Date.now() + 10_000);
    assert.equal(resumed.snapshot().pending, 0);
    assert.equal(resumed.snapshot().unavailable, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("photo refresh respects flood waits and serializes work per account", async () => {
  assert.equal(avatarRetryDelay({ seconds: 120 }), 125_000);
  assert.equal(avatarRetryDelay(new Error("FLOOD_WAIT_3600")), 3_605_000);
  assert.equal(avatarRetryDelay({ output: { statusCode: 429 } }), 3_600_000);
  assert.equal(avatarRetryDelay({ data: 429, output: { statusCode: 500 } }), 3_600_000);
  assert.equal(avatarUnavailable({ data: 404, output: { statusCode: 500 } }), true);
  assert.equal(avatarUnavailable({ data: 403, output: { statusCode: 500 } }), true);
  assert.equal(avatarUnavailable({ data: 429, output: { statusCode: 500 } }), false);
  assert.equal(avatarUnavailable(new Error("connection closed")), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-avatar-test-"));
  try {
    const queue = new AvatarBackfill(path.join(dir, "jobs.json"));
    queue.start([job]);
    let release!: () => void;
    const first = queue.runOne("a", async () => {
      await new Promise<void>(resolve => { release = resolve; });
      throw { seconds: 120 };
    });
    await queue.runOne("a", async () => { assert.fail("overlapping work"); });
    release(); await first;
    assert.equal(queue.snapshot().pending, 1);
    assert.ok(queue.snapshot().retryAt.a >= Date.now() + 120_000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
