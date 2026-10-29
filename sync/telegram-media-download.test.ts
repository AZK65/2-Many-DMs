import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import { TelegramMediaDownloader } from "./telegram-media-download";

const input = { apiId: 1, apiHash: "test", session: "test", media: new Uint8Array(), maxBytes: 10 };
class FakeWorker extends EventEmitter {
  terminated = false;
  async terminate() { this.terminated = true; return 0; }
}

test("a stalled transport is disposed before the next file can start", async () => {
  const workers: FakeWorker[] = [];
  let release!: () => void;
  let disposing!: () => void;
  const disposalStarted = new Promise<void>(resolve => { disposing = resolve; });
  const disposalGate = new Promise<void>(resolve => { release = resolve; });
  const downloader = new TelegramMediaDownloader(() => {
    const worker = new FakeWorker();
    if (!workers.length) worker.terminate = async () => {
      disposing(); await disposalGate; worker.terminated = true; return 0;
    };
    else setImmediate(() => worker.emit("message", { bytes: new Uint8Array([1, 2]) }));
    workers.push(worker);
    return worker;
  }, 20);
  const first = assert.rejects(downloader.download(input), /stalled/);
  const second = downloader.download(input);
  await disposalStarted;
  assert.equal(workers.length, 1);
  release();
  await first;
  assert.deepEqual(await second, Buffer.from([1, 2]));
  assert.ok(workers.every(worker => worker.terminated));
  await downloader.stop();
});

test("the timeout terminates a genuinely stuck thread, not just its observer", async () => {
  let worker!: Worker;
  let exited = false;
  const downloader = new TelegramMediaDownloader(() => {
    worker = new Worker("setInterval(() => {}, 1000)", { eval: true, execArgv: [] });
    worker.once("exit", () => { exited = true; });
    return worker;
  }, 100);
  await assert.rejects(downloader.download(input), /stalled/);
  assert.equal(exited, true);
  assert.equal(worker.threadId, -1);
  await downloader.stop();
});

test("success, worker errors and invalid files all dispose their transport", async () => {
  for (const scenario of ["success", "error", "empty", "oversized", "exit"]) {
    const worker = new FakeWorker();
    const downloader = new TelegramMediaDownloader(() => {
      setImmediate(() => {
        if (scenario === "error") worker.emit("error", Error("offline"));
        else if (scenario === "exit") worker.emit("exit", 1);
        else worker.emit("message", { bytes: new Uint8Array(scenario === "success" ? 2 : scenario === "empty" ? 0 : 11) });
      });
      return worker;
    }, 1000);
    if (scenario === "success") assert.equal((await downloader.download(input)).length, 2);
    else await assert.rejects(downloader.download(input));
    assert.equal(worker.terminated, true, scenario);
    await downloader.stop();
  }
});

test("Telegram flood waits prevent queued files from creating new connections", async () => {
  let created = 0;
  const downloader = new TelegramMediaDownloader(() => {
    created++;
    const worker = new FakeWorker();
    setImmediate(() => worker.emit("message", { error: "FLOOD_WAIT_120", seconds: 120 }));
    return worker;
  });
  const first = assert.rejects(downloader.download(input), /FLOOD_WAIT/);
  const second = assert.rejects(downloader.download(input), /pause downloads/);
  await Promise.all([first, second]);
  assert.equal(created, 1);
  await downloader.stop();
});

test("shutdown cancels the active file and drains queued files without starting them", async () => {
  const worker = new FakeWorker();
  let created = 0;
  const downloader = new TelegramMediaDownloader(() => { created++; return worker; });
  const active = assert.rejects(downloader.download(input), /stopped/);
  const queued = assert.rejects(downloader.download(input), /stopped/);
  await Promise.resolve();
  await downloader.stop();
  await Promise.all([active, queued]);
  assert.equal(created, 1);
  assert.equal(worker.terminated, true);
  await assert.rejects(downloader.download(input), /stopped/);
});

test("private or absent profile photos finish cleanly without accepting empty attachments", async () => {
  const downloader = new TelegramMediaDownloader(() => {
    const worker = new FakeWorker();
    setImmediate(() => worker.emit("message", { unavailable: true }));
    return worker;
  });
  assert.equal((await downloader.download({ ...input, profile: { id: "123", isGroup: false } })).length, 0);
  await assert.rejects(downloader.download(input), /empty/);
  await downloader.stop();
});
