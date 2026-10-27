import assert from "node:assert/strict";
import { test } from "node:test";
import { canAutoLoadMedia, VisibleMediaQueue } from "./automatic-media";

test("only Telegram stickers and positively identified GIFs auto-download", () => {
  assert.equal(canAutoLoadMedia("telegram", { mediaType: "sticker" }), true);
  assert.equal(canAutoLoadMedia("telegram", { mediaType: "video", mediaIsGif: true }), true);
  assert.equal(canAutoLoadMedia("telegram", { mediaType: "file", mediaName: "dance.gif" }), true);
  for (const platform of ["x", "whatsapp", "discord"]) assert.equal(canAutoLoadMedia(platform, { mediaType: "sticker" }), false);
  for (const mediaType of ["video", "file", "audio", "image"]) assert.equal(canAutoLoadMedia("telegram", { mediaType }), false);
});

test("visible queue is serial, deduplicated, and skips cards scrolled away", async () => {
  const queue = new VisibleMediaQueue(Date.now, async () => {});
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run("a", () => true, async () => { calls.push("a"); await gate; });
  assert.equal(queue.run("a", () => true, async () => { calls.push("duplicate"); }), first);
  const hidden = queue.run("hidden", () => false, async () => { calls.push("hidden"); });
  const next = queue.run("b", () => true, async () => { calls.push("b"); });
  await Promise.resolve();
  assert.deepEqual(calls, ["a"]);
  release();
  assert.deepEqual(await Promise.all([first, hidden, next]), [true, false, true]);
  assert.deepEqual(calls, ["a", "b"]);
});

test("failed automatic media is not hammered when a chat is reopened", async () => {
  let now = 1000, calls = 0;
  const queue = new VisibleMediaQueue(() => now, async () => {});
  const fail = async () => { calls++; throw Error("unavailable"); };
  await assert.rejects(queue.run("a", () => true, fail));
  await assert.rejects(queue.run("a", () => true, fail));
  assert.equal(calls, 1);
  now += 300_001;
  await assert.rejects(queue.run("a", () => true, fail));
  assert.equal(calls, 2);
});
