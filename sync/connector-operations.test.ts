import assert from "node:assert/strict";
import test from "node:test";
import { ConnectorOperations } from "./connector-operations";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a caller timeout cannot release a live recovery or create a second session", async () => {
  const guard = new ConnectorOperations<object>();
  const adapter = {};
  const recovery = deferred();
  let launches = 0;
  const first = guard.runLifecycle(adapter, "recover", () => {
    launches++;
    return recovery.promise;
  });
  await Promise.race([first, Promise.resolve("caller deadline")]);
  assert.equal(guard.canRecover(adapter), false);
  const second = guard.runLifecycle(adapter, "recover", async () => { launches++; });
  assert.equal(second, first);
  assert.equal(launches, 1);
  recovery.resolve();
  await first;
  assert.equal(guard.canRecover(adapter), true);
});

test("an unconfirmed send retains transport ownership until it actually completes", async () => {
  const guard = new ConnectorOperations<object>();
  const adapter = {};
  const outbound = deferred<string>();
  const send = guard.send(adapter, () => outbound.promise);
  await Promise.race([send, Promise.resolve("HTTP deadline")]);
  let recovered = false;
  await assert.rejects(guard.runLifecycle(adapter, "recover", async () => { recovered = true; }), /deferred/);
  assert.equal(recovered, false);
  assert.equal(guard.snapshot(adapter).activeSends, 1);
  outbound.resolve("sent");
  assert.equal(await send, "sent");
  assert.equal(guard.canRecover(adapter), true);
});

test("one stuck connector does not prevent another connector recovering", async () => {
  const guard = new ConnectorOperations<object>();
  const stalled = {};
  const other = {};
  const startup = deferred();
  const start = guard.runLifecycle(stalled, "start", () => startup.promise);
  await guard.runLifecycle(other, "recover", async () => {});
  assert.equal(guard.canRecover(other), true);
  assert.equal(guard.canRecover(stalled), false);
  startup.resolve();
  await start;
});

test("recovery blocks new sends before touching the platform and releases on failure", async () => {
  const guard = new ConnectorOperations<object>();
  const adapter = {};
  const pending = deferred();
  const recovery = guard.runLifecycle(adapter, "recover", () => pending.promise);
  let sent = false;
  await assert.rejects(guard.send(adapter, async () => { sent = true; }), /no message was sent/);
  assert.equal(sent, false);
  pending.reject(new Error("offline"));
  await assert.rejects(recovery, /offline/);
  assert.equal(guard.canRecover(adapter), true);
});
