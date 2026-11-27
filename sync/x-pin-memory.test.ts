import assert from "node:assert/strict";
import { test } from "node:test";
import { XPinMemory, pinIdentity, withXPinLock, type PinTransport } from "./x-pin-memory";
import type { XUnlockState } from "../src/lib/x-unlock-state";

const accepted: XUnlockState = { state: "unlocked", detail: "Test unlock", pinVerified: true };
function fixture() {
  let saved: string | undefined; let armed = false;
  const calls: string[] = [];
  const transport: PinTransport = async (command, pin) => {
    calls.push(command);
    if (command === "save") { saved = pin; armed = true; }
    if (command === "forget") { saved = undefined; armed = false; }
    if (command === "resume" && saved) armed = true;
    if (command === "take" && saved && armed) { armed = false; return { pin: saved }; }
    return { saved: Boolean(saved), autoUnlock: armed };
  };
  return { memory: new XPinMemory(transport, true), transport, calls };
}

test("remembering is opt-in and only stores a PIN actually accepted by X", async () => {
  const { memory, calls } = fixture();
  for (const result of [{ ...accepted, pinVerified: false }, { state: "rejected", detail: "Test rejection" } as XUnlockState]) {
    assert.ok((await memory.rememberVerified("0123", result)).error);
  }
  assert.equal(calls.includes("save"), false);
  assert.equal((await memory.rememberVerified("0123", accepted)).autoUnlock, true);
});

test("a successful automatic unlock is rearmed for the next process", async () => {
  const { memory, transport } = fixture();
  await memory.rememberVerified("0123", accepted);
  let attempts = 0;
  await new XPinMemory(transport, true).restore(async pin => { attempts++; assert.equal(pin, "0123"); return accepted; });
  assert.equal(attempts, 1);
  assert.deepEqual(await memory.status(), { available: true, saved: true, autoUnlock: true });
});

test("rejected, uncertain, and crashed automatic attempts stay paused across restarts", async () => {
  for (const outcome of ["rejected", "error", "crash"] as const) {
    const { memory, transport } = fixture();
    await memory.rememberVerified("0123", accepted);
    let attempts = 0;
    const unlock = async (): Promise<XUnlockState> => { attempts++; if (outcome === "crash") throw new Error("synthetic"); return { state: outcome, detail: "synthetic" }; };
    await memory.restore(unlock);
    await new XPinMemory(transport, true).restore(unlock);
    assert.equal(attempts, 1);
    assert.equal((await memory.status()).autoUnlock, false);
  }
});

test("forget removes the PIN and prevents subsequent automatic unlock", async () => {
  const { memory } = fixture();
  await memory.rememberVerified("0123", accepted);
  assert.equal((await memory.forget()).saved, false);
  await memory.restore(async () => { assert.fail("Forgotten PIN must not be submitted"); });
});

test("status projection and failures never disclose secrets", async () => {
  const memory = new XPinMemory(async () => ({ saved: true, autoUnlock: true, pin: "0123" }), true);
  assert.equal(JSON.stringify(await memory.status()).includes("0123"), false);
  const failing = new XPinMemory(async () => { throw new Error("secret 0123"); }, true);
  assert.equal(JSON.stringify(await failing.rememberVerified("0123", accepted)).includes("0123"), false);
  assert.equal((await failing.status()).available, false);
});

test("unsupported hosts never use a plaintext fallback", async () => {
  const memory = new XPinMemory(async () => { assert.fail("No credential transport allowed"); }, false);
  assert.equal((await memory.rememberVerified("0123", accepted)).available, false);
  await memory.restore(async () => { assert.fail("No unlock allowed"); });
});

test("credentials are isolated by account, workspace, and signed-in session", () => {
  const a = pinIdentity("account-a", "session-a", "/workspace-a");
  assert.notEqual(a.account, pinIdentity("account-b", "session-a", "/workspace-a").account);
  assert.notEqual(a.account, pinIdentity("account-a", "session-a", "/workspace-b").account);
  assert.notEqual(a.binding, pinIdentity("account-a", "session-b", "/workspace-a").binding);
});

test("forget waits for an in-flight save and wins over it", async () => {
  const { memory } = fixture();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const saving = withXPinLock("a", async () => { await wait; return memory.rememberVerified("0123", accepted); });
  const forgetting = withXPinLock("a", () => memory.forget());
  release(); await saving; await forgetting;
  assert.equal((await memory.status()).saved, false);
});
