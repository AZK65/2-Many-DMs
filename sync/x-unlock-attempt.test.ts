import assert from "node:assert/strict";
import test from "node:test";
import { runXUnlockAttempt, unlockStep, XUnlockTimeout } from "./x-unlock-attempt";

test("one deadline covers a hung browser command and retires it before returning", async () => {
  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  let typed = false, retired = false;
  const attempt = runXUnlockAttempt(async signal => {
    await unlockStep(signal, () => stalled);
    await unlockStep(signal, async () => { typed = true; });
  }, async () => { retired = true; }, 25);
  await assert.rejects(attempt, XUnlockTimeout);
  assert.equal(retired, true);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typed, false, "a late CDP response must not continue typing a PIN");
});

test("a completed or rejected check never closes a healthy page", async () => {
  let retired = 0;
  const retire = async () => { retired++; };
  assert.equal(await runXUnlockAttempt(async () => "unlocked", retire, 50), "unlocked");
  assert.equal(await runXUnlockAttempt(async () => "rejected", retire, 50), "rejected");
  await assert.rejects(runXUnlockAttempt(async () => { throw Error("page closed"); }, retire, 50), /page closed/);
  assert.equal(retired, 0);
});
