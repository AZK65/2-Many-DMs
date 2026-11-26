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

test("background first pass checkpoints recent text separately and preserves old media work", async () => {
  const adapter = new XAdapter() as any;
  const now = Date.now();
  const repair = { id: "recent", name: "Recent", inboxCategory: "general", previewKey: `in:hello:${now}`, activityAt: now, attempts: 2, mediaRecovery: true, sinceTimestamp: now - 30 * 86400000 };
  const calls: any[][] = [];
  Object.assign(adapter, { state: "ready", persistRepairState() {}, scheduleAutomaticRepair() {}, requestHistory: async (...args: any[]) => { calls.push(args); } });
  adapter.automaticRepairQueue.set("general:recent", repair);
  adapter.repairRetryAt.set("general:recent", now + 3600000);
  await adapter.processAutomaticRepair();
  assert.equal(calls[0][3], 50);
  assert.equal(calls[0][4].recentHistory, true);
  assert.equal(calls[0][4].sinceTimestamp, undefined);
  assert.equal((repair as any).recentKey, repair.previewKey);
  assert.equal(adapter.automaticRepairQueue.get("general:recent"), repair);
  assert.equal(adapter.repairRetryAt.get("general:recent"), now + 3600000);
  assert.equal(adapter.lastRepairAt.size, 0, "recent coverage is not full history");
  assert.equal(adapter.repairedPreviews.size, 0);
});

test("new replies during a recent pass are not marked covered by the previous snapshot", async () => {
  const adapter = new XAdapter() as any;
  const now = Date.now();
  const chat = { id: "chat", name: "Fixture", inboxCategory: "general", preview: "hello", direction: "in", timestamp: now };
  Object.assign(adapter, { state: "ready", persistRepairState() {}, scheduleAutomaticRepair() {} });
  adapter.enqueueAutomaticRepair(chat);
  adapter.requestHistory = async () => adapter.enqueueAutomaticRepair({ ...chat, preview: "new reply", timestamp: now + 1 });
  await adapter.processAutomaticRepair();
  const job = adapter.automaticRepairQueue.get("general:chat");
  assert.equal(job.recentKey, undefined);
  assert.match(job.previewKey, /new reply/);
});

test("a recent read failure preserves work, backs off, and lets the next chat run", async () => {
  const adapter = new XAdapter() as any;
  const now = Date.now(), calls: string[] = [];
  Object.assign(adapter, { state: "ready", persistRepairState() {}, scheduleAutomaticRepair() {}, requestHistory: async (id: string) => { calls.push(id); if (id === "new") throw Error("Recent window incomplete"); } });
  for (const [id, age] of [["old", 1000], ["new", 0]] as const) adapter.automaticRepairQueue.set(id, { id, name: id, previewKey: `in:hello:${now - age}`, activityAt: now - age, attempts: 0 });
  await adapter.processAutomaticRepair(); await adapter.processAutomaticRepair();
  assert.deepEqual(calls, ["new", "old"]);
  assert.ok(adapter.automaticRepairQueue.get("new").recentRetryAt > now);
  assert.equal(adapter.automaticRepairQueue.size, 2);
});

test("recent history saves before attachments and only succeeds with verified latest-window coverage", async () => {
  const adapter = new XAdapter() as any;
  const timestamp = Date.now(), latest = { preview: "hello", direction: "in", timestamp };
  let covered = false, undated = 0, observed: any[] = [];
  Object.assign(adapter, {
    page: { bringToFront: async () => {} }, chatPage: {}, state: "ready", onMessage: async () => {},
    scrapeConversations: async () => [], parkActionPage: async () => {},
    persistMessageWindow: async () => ({ undated, unavailableAttachments: 3 }),
    scrapeMessages: async (...args: any[]) => { observed = args; return { messages: [{ id: "native", text: "hello", direction: "in", timestamp }], covered }; },
  });
  const read = () => { adapter.lastHistoryRequestAt = 0; return adapter.requestHistory("chat", "", 0, 50, { recentOnly: true, recentHistory: true, latestPreview: latest }); };
  await assert.rejects(read(), /has not verified/);
  covered = true; undated = 1; await assert.rejects(read(), /has not verified/);
  undated = 0; await read();
  assert.equal(observed[1], 8, "bounded recent-history scroll budget");
  assert.equal(observed[4].latest, latest);
  assert.equal(observed[4].recentOnly, true, "old media downloads stay out of the first pass");
  assert.equal(adapter.busy, false);
});

test("recent work interrupts a deeper pass but never itself, and wakes an old timer promptly", () => {
  const adapter = new XAdapter() as any;
  adapter.automaticRepairQueue.set("recent", { id: "recent", previewKey: "in:hello:1", activityAt: Date.now(), attempts: 0 });
  adapter.automaticRepairRunning = true;
  assert.throws(() => adapter.yieldHistoryForRecentChats(), /paused for recent chats/);
  adapter.automaticRecentRepairRunning = true;
  assert.doesNotThrow(() => adapter.yieldHistoryForRecentChats());
  adapter.automaticRepairRunning = false;
  adapter.scheduleAutomaticRepair(60000);
  const oldTimer = adapter.automaticRepairTimer;
  adapter.scheduleAutomaticRepair();
  assert.notEqual(adapter.automaticRepairTimer, oldTimer);
  assert.ok(adapter.automaticRepairScheduledAt < Date.now() + 2000);
  clearTimeout(adapter.automaticRepairTimer);
});
