import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryAttempts } from "./delivery-attempts";

test("an explicit retry starts after a failure, while duplicate and stale requests never send twice", async () => {
  const attempts = new DeliveryAttempts<string>();
  let sends = 0;
  const fail = () => { sends++; return Promise.reject(new Error("composer unavailable")); };
  const first = attempts.run("message", 1, fail);
  assert.equal(attempts.run("message", 1, fail), first);
  await assert.rejects(first, /composer unavailable/);
  await assert.rejects(attempts.run("message", 1, fail), /composer unavailable/);
  assert.equal(sends, 1);
  const retry = attempts.run("message", 2, async () => { sends++; return "native-id"; });
  assert.equal(await retry, "native-id");
  assert.equal(await attempts.run("message", 1, fail), "native-id");
  assert.equal(await attempts.run("message", 2, fail), "native-id");
  assert.equal(sends, 2);
});

test("attempt changes cannot overlap a still-running send or block another message", async () => {
  const attempts = new DeliveryAttempts<string>();
  let finish!: (value: string) => void;
  const first = attempts.run("message", 1, () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  assert.equal(attempts.run("message", 2, async () => { throw new Error("duplicate send"); }), first);
  assert.equal(await attempts.run("other", 1, async () => "other-id"), "other-id");
  finish("first-id");
  assert.equal(await first, "first-id");
});
