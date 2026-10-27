import assert from "node:assert/strict";
import test from "node:test";
import { appendDictation, wisprSetupProblem, wisprRequest, WISPR_HELPER_URL } from "./wispr-bridge";

test("dictation preserves an existing draft and never inserts empty text", () => {
  assert.equal(appendDictation("Hello", "  there  "), "Hello there");
  assert.equal(appendDictation("Hello\n", "there"), "Hello\nthere");
  assert.equal(appendDictation("Hello", "  "), "Hello");
  assert.equal(appendDictation("", "there"), "there");
});
test("setup distinguishes missing app, stopped app and missing permissions", () => {
  const status = { version: 1, installed: true, running: true, accessibility: true };
  assert.equal(wisprSetupProblem(status), null);
  assert.match(wisprSetupProblem({ ...status, installed: false })!, /Install/);
  assert.match(wisprSetupProblem({ ...status, running: false })!, /Open/);
  assert.match(wisprSetupProblem({ ...status, accessibility: false })!, /Accessibility/);
  assert.match(wisprSetupProblem({ ...status, version: 2 })!, /Update/);
});
test("bridge talks only to viewer loopback, omits cookies and never retries a toggle", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, WISPR_HELPER_URL + "/toggle");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init?.body as string), { requestId: "fixture" });
    throw Error("timeout");
  };
  try { await assert.rejects(wisprRequest("toggle", { requestId: "fixture" }, "token"), /may have started/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
