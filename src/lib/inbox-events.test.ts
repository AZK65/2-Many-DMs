import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { inboxEventStream } from "./inbox-events";

test("a write from another process wakes the inbox without carrying message data", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-event-test-"));
  const abort = new AbortController();
  const reader = inboxEventStream(abort.signal, dir).getReader();
  t.after(() => { abort.abort(); fs.rmSync(dir, { recursive: true, force: true }); });
  const decode = new TextDecoder();
  assert.match(decode.decode((await reader.read()).value), /event: ready/);
  const changed = reader.read();
  execFileSync(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1], 'synthetic-private-message')", path.join(dir, "revision")]);
  const frame = decode.decode((await changed).value);
  assert.equal(frame, "event: change\ndata: {}\n\n");
  abort.abort();
  assert.equal((await reader.read()).done, true);
});

test("browser cancellation releases its stream even without an abort event", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-cancel-test-"));
  const reader = inboxEventStream(new AbortController().signal, dir).getReader();
  await reader.read();
  await reader.cancel();
  fs.rmSync(dir, { recursive: true, force: true });
});
