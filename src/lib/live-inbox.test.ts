import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { watchInboxChanges } from "./live-inbox";

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 10000 });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget();
  const streams: FakeSource[] = [];
  class FakeSource extends EventTarget {
    onopen?: () => void;
    onerror?: () => void;
    closed = false;
    constructor(readonly url: string) { super(); streams.push(this); }
    close() { this.closed = true; }
  }
  const original = { document: Object.getOwnPropertyDescriptor(globalThis, "document"), window: Object.getOwnPropertyDescriptor(globalThis, "window"), EventSource: Object.getOwnPropertyDescriptor(globalThis, "EventSource") };
  Object.assign(globalThis, { document: doc, window: win, EventSource: FakeSource });
  t.after(() => { for (const key of Object.keys(original) as (keyof typeof original)[]) { const descriptor = original[key]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } });
  const flush = async (ms = 0) => { t.mock.timers.tick(ms); await new Promise<void>(resolve => setImmediate(resolve)); };
  return { doc, win, streams, flush };
}

test("inbox and split panes share one push connection and refresh ahead of polling", async t => {
  const f = fixture(t); let inbox = 0, pane = 0;
  const a = watchInboxChanges(async () => { inbox++; }, 5000);
  const b = watchInboxChanges(async () => { pane++; }, 3000);
  t.after(() => { a(); b(); });
  assert.equal(f.streams.length, 1);
  assert.equal(f.streams[0].url, "/api/inbox/events");
  f.streams[0].onopen!(); await f.flush();
  f.streams[0].dispatchEvent(new Event("change")); await f.flush(150);
  assert.equal(inbox, 2); assert.equal(pane, 2);
  await f.flush(5000);
  assert.equal(inbox, 2, "healthy stream does not keep polling every five seconds");
  a(); assert.equal(f.streams[0].closed, false);
  b(); assert.equal(f.streams[0].closed, true);
});

test("events during a slow fetch are coalesced into one follow-up without overlapping requests", async t => {
  const f = fixture(t); let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stop = watchInboxChanges(async () => { calls++; if (calls === 1) await gate; }, 3000);
  t.after(stop);
  f.streams[0].onopen!(); await f.flush();
  for (let i = 0; i < 20; i++) f.streams[0].dispatchEvent(new Event("change"));
  await f.flush(5000); assert.equal(calls, 1);
  release(); await f.flush(); await f.flush();
  assert.equal(calls, 2);
});

test("disconnection uses fallback polling and returning to the tab refreshes immediately", async t => {
  const f = fixture(t); let calls = 0;
  const stop = watchInboxChanges(async () => { calls++; }, 3000);
  t.after(stop);
  f.streams[0].onopen!(); await f.flush();
  f.streams[0].onerror!(); await f.flush(3000); await f.flush();
  assert.equal(calls, 2);
  f.doc.visibilityState = "hidden";
  await f.flush(3000); assert.equal(calls, 2);
  f.doc.visibilityState = "visible";
  f.doc.dispatchEvent(new Event("visibilitychange")); await f.flush();
  assert.equal(calls, 3);
  stop(); await f.flush(30_000); assert.equal(calls, 3);
});
