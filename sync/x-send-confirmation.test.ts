import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForXSendConfirmation, type XSendConfirmation } from "./x-send-confirmation";
import { normalizeXMessageText } from "./x-message-text";

test("X link display normalization keeps distinct URLs distinct", () => {
  assert.equal(normalizeXMessageText("https://example.com/start?code=ONE\nJoin here"), normalizeXMessageText("example.com/start?code=ONE Join here"));
  assert.notEqual(normalizeXMessageText("https://example.com/start?code=ONE"), normalizeXMessageText("example.com/start?code=TWO"));
  assert.notEqual(normalizeXMessageText("hello"), normalizeXMessageText("hello again"));
});

function fixture(results: XSendConfirmation[]) {
  let now = 0;
  let reads = 0;
  return {
    read: async () => results[Math.min(reads++, results.length - 1)],
    clock: () => now,
    pause: async (ms: number) => { now += ms; },
    reads: () => reads,
  };
}

test("X waits for the native bubble after the composer clears", async () => {
  const native = { kind: "message" as const, id: "native-id", text: "hello" };
  const f = fixture([{ kind: "accepted" }, false, native]);
  assert.deepEqual(await waitForXSendConfirmation(f.read, 1000, f.clock, f.pause), native);
  assert.equal(f.reads(), 3);
});

test("X retains provisional acceptance when no native ID paints", async () => {
  const f = fixture([{ kind: "accepted" }, false]);
  assert.deepEqual(await waitForXSendConfirmation(f.read, 1000, f.clock, f.pause), { kind: "accepted" });
  assert.ok(f.reads() > 1);
});

test("X never confirms an unobserved send", async () => {
  const f = fixture([false]);
  assert.equal(await waitForXSendConfirmation(f.read, 1000, f.clock, f.pause), false);
});

test("accepted sends release the queue in 600ms, not the 8/12-second native-ID timeout", async () => {
  for (const timeout of [8000, 12000]) {
    const f = fixture([{ kind: "accepted" }]);
    assert.deepEqual(await waitForXSendConfirmation(f.read, timeout, f.clock, f.pause), { kind: "accepted" });
    assert.equal(f.clock(), 600);
  }
});

test("an unaccepted send retains the full confirmation window", async () => {
  const f = fixture([false]);
  assert.equal(await waitForXSendConfirmation(f.read, 12000, f.clock, f.pause), false);
  assert.equal(f.clock(), 12000);
});
