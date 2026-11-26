import assert from "node:assert/strict";
import test from "node:test";
import { XAdapter } from "./adapters/x";

test("opening X reads just the newest window without waiting for deep-history pacing or clearing its checkpoint", async () => {
  const adapter = new XAdapter() as any;
  const saved: unknown[] = [];
  const calls: unknown[][] = [];
  Object.assign(adapter, {
    page: { bringToFront: async () => {} }, chatPage: {}, state: "ready", onMessage: async () => {},
    lastHistoryRequestAt: Date.now(), scrapeConversations: async () => [], parkActionPage: async () => {},
    persistMessageWindow: async (_id: string, rows: unknown[]) => { saved.push(...rows); return { undated: 0, unavailableAttachments: 0 }; },
    scrapeMessages: async (...args: any[]) => { calls.push(args); await args[5]([{ id: "newest" }]); return { messages: [{ id: "newest" }], covered: false }; },
  });
  adapter.automaticRepairQueue.set("general:111-222", { id: "111-222", attempts: 0 });
  await assert.rejects(adapter.requestHistory("111-222", "", 0), /being paced/);
  await adapter.requestHistory("111-222", "", 0, 30, { recentOnly: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 0, "no backwards scrolling for an opened chat");
  assert.equal((calls[0][4] as any).recentOnly, true);
  assert.ok(saved.length > 0 && saved.every(row => (row as any).id === "newest"));
  assert.equal(adapter.automaticRepairQueue.size, 1);
  assert.equal(adapter.busy, false);
  adapter.inboxRetryAt = Date.now() + 60_000;
  await assert.rejects(adapter.requestHistory("111-222", "", 0, 30, { recentOnly: true }), /cooling down/);
  assert.equal(calls.length, 1);
  adapter.recentRefresh.stop();
});

test("fresh X replies outrank attachment repair without discarding either job", async () => {
  const adapter = new XAdapter() as any;
  const selected: string[] = [];
  Object.assign(adapter, { state: "ready", persistRepairState() {}, scheduleAutomaticRepair() {},
    requestHistory: async (id: string) => { selected.push(id); } });
  adapter.automaticRepairQueue.set("general:old", { id: "old", name: "Old", previewKey: "old", attempts: 0, imageRecovery: true });
  adapter.automaticRepairQueue.set("general:new", { id: "new", name: "New", previewKey: "new", attempts: 0, live: true });
  await adapter.processAutomaticRepair();
  assert.deepEqual(selected, ["new"]);
  assert.equal(adapter.automaticRepairQueue.has("general:old"), true);
  adapter.recentRefresh.stop();
});
