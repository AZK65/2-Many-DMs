import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireWorkerLock, acquireWorkerLocks } from "./worker-lock";

function fixture(t: { after(fn: () => void): void }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-lock-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("a living owner blocks another worker regardless of its control port", (t) => {
  const directory = fixture(t);
  const first = acquireWorkerLock(directory, { pid: 101, isProcessAlive: () => true });
  assert.throws(() => acquireWorkerLock(directory, { pid: 202, isProcessAlive: () => true }), /PID 101/);
  first.release();
  const second = acquireWorkerLock(directory, { pid: 202, isProcessAlive: () => true });
  second.release();
});

test("stale recovery and delayed old release cannot remove a replacement owner", (t) => {
  const directory = fixture(t);
  const first = acquireWorkerLock(directory, { pid: 101, isProcessAlive: () => true });
  const second = acquireWorkerLock(directory, { pid: 202, isProcessAlive: (pid) => pid !== 101 });
  first.release();
  first.release();
  assert.equal(fs.existsSync(second.ownerFile), true);
  assert.throws(() => acquireWorkerLock(directory, { pid: 303, isProcessAlive: () => true }), /PID 202/);
  second.release();
});

test("an empty startup directory is protected briefly then reclaimed after a crash", (t) => {
  const directory = fixture(t);
  const empty = path.join(directory, ".omnicrm-sync.lock");
  fs.mkdirSync(empty);
  assert.throws(() => acquireWorkerLock(directory, { pid: 101, isProcessAlive: () => false }), /acquiring/);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(empty, old, old);
  const lock = acquireWorkerLock(directory, { pid: 101, isProcessAlive: () => false });
  lock.release();
});

test("unknown ownership records fail closed and are preserved", (t) => {
  const directory = fixture(t);
  const lockDirectory = path.join(directory, ".omnicrm-sync.lock");
  fs.mkdirSync(lockDirectory);
  const unknown = path.join(lockDirectory, "unrecognized-owner");
  fs.writeFileSync(unknown, "keep");
  assert.throws(() => acquireWorkerLock(directory, { pid: 101, isProcessAlive: () => false }), /Unrecognized/);
  assert.equal(fs.readFileSync(unknown, "utf8"), "keep");
});

test("partial multi-directory acquisition releases only locks it acquired", (t) => {
  const directory = fixture(t);
  const firstDirectory = path.join(directory, "a");
  const secondDirectory = path.join(directory, "b");
  const existing = acquireWorkerLock(secondDirectory, { pid: 101, isProcessAlive: () => true });
  assert.throws(() => acquireWorkerLocks([firstDirectory, secondDirectory], {
    pid: 202, isProcessAlive: () => true,
  }), /PID 101/);
  assert.equal(fs.existsSync(path.join(firstDirectory, ".omnicrm-sync.lock")), false);
  assert.equal(fs.existsSync(existing.ownerFile), true);
  existing.release();
});

test("a corrupted owner marker is preserved even when its PID appears dead", (t) => {
  const directory = fixture(t);
  const first = acquireWorkerLock(directory, { pid: 101, isProcessAlive: () => true });
  fs.writeFileSync(first.ownerFile, "incomplete");
  assert.throws(() => acquireWorkerLock(directory, { pid: 202, isProcessAlive: () => false }), /Unrecognized/);
  assert.equal(fs.readFileSync(first.ownerFile, "utf8"), "incomplete");
});

test("aliased data paths share one physical lock", (t) => {
  const directory = fixture(t);
  const alias = path.join(directory, "alias");
  const data = path.join(directory, "data");
  fs.mkdirSync(data);
  fs.symlinkSync(data, alias);
  const release = acquireWorkerLocks([data, alias], { pid: 101, isProcessAlive: () => true });
  assert.throws(() => acquireWorkerLock(alias, { pid: 202, isProcessAlive: () => true }), /PID 101/);
  release();
});
