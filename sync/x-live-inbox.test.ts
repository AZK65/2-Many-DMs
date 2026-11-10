import assert from "node:assert/strict";
import test from "node:test";
import { XAdapter } from "./adapters/x";

const conversation = (id = "live", preview = "new reply") => ({
  id, name: id, handle: id, preview, direction: "in", unread: true,
  inboxCategory: "general", timestamp: Date.now(),
});

function fixture() {
  const saved: any[] = [];
  const adapter = new XAdapter() as any;
  const page = { isClosed: () => false, url: () => "https://x.com/i/chat", bringToFront: async () => {} };
  Object.assign(adapter, {
    page, state: "ready", busy: true,
    persistRepairState: () => {}, scheduleAutomaticRepair: () => {},
    onMessage: async (message: any) => { saved.push(message); },
  });
  return { adapter, page, saved };
}

test("newest readable replies survive a later older-history failure", async () => {
  const { adapter, page, saved } = fixture();
  adapter.busy = false;
  adapter.chatPage = page;
  adapter.scrapeConversations = async () => [];
  adapter.parkActionPage = async () => {};
  adapter.scrapeMessages = async (_id: string, _rounds: number, _request: boolean, _timeout: number, _range: unknown, onWindow: (rows: any[]) => Promise<void>) => {
    await onWindow([{ id: "native", text: "Full newest reply", direction: "in", timestamp: Date.now() - 1000 }]);
    assert.equal(saved[0].body, "Full newest reply");
    throw new Error("Older window not available");
  };
  await assert.rejects(adapter.requestHistory("live", "", 0, 100), /Older window/);
  assert.equal(saved.length, 1);
});

test("full text publishes before attachment downloads; passive reads never download", async () => {
  const { adapter } = fixture();
  const events: string[] = [];
  const page = { evaluate: async () => [{ id: "native", text: "Full caption at 5:30 PM", direction: "in", dateHints: ["2026-01-01T00:00:00Z"], attachments: [{ type: "image", source: "https://pbs.twimg.com/media/fixture.jpg" }] }] };
  adapter.downloadAttachment = async () => { events.push("download"); return { type: "image", url: "/media/fixture.jpg" }; };
  const rows = await adapter.readMessageWindow(page, { onWindow: async (messages: any[]) => { events.push(messages[0].attachments[0].url ? "media saved" : "text saved"); } });
  assert.deepEqual(events, ["text saved", "download", "media saved"]);
  assert.equal(rows[0].text, "Full caption at 5:30 PM");
  events.length = 0;
  await adapter.readMessageWindow(page, { passive: true });
  assert.deepEqual(events, []);
});

test("failed repairs remain queued durably and respect their retry deadline", async () => {
  const { adapter } = fixture();
  adapter.busy = false;
  adapter.enqueueAutomaticRepair(conversation("blocked"));
  let attempts = 0;
  adapter.requestHistory = async () => { attempts++; throw Error("X request conversation was not found"); };
  await adapter.processAutomaticRepair(); await adapter.processAutomaticRepair(); await adapter.processAutomaticRepair();
  assert.equal(attempts, 3);
  assert.equal(adapter.automaticRepairQueue.has("general:blocked"), true);
  assert.ok(adapter.repairRetryAt.get("general:blocked") > Date.now());
  await adapter.processAutomaticRepair();
  assert.equal(attempts, 3);
  adapter.repairRetryAt.set("general:blocked", Date.now() - 1);
  adapter.requestHistory = async () => { attempts++; };
  await adapter.processAutomaticRepair();
  assert.equal(attempts, 4);
  assert.equal(adapter.automaticRepairQueue.has("general:blocked"), false);
  assert.equal(adapter.repairRetryAt.has("general:blocked"), false);
});

test("a request accepted elsewhere falls back to the same ID in General only after not-found", async () => {
  const { adapter, page, saved } = fixture();
  adapter.busy = false;
  adapter.chatPage = page;
  adapter.scrapeConversations = async () => [];
  adapter.parkActionPage = async () => {};
  const calls: Array<[string, boolean]> = [];
  adapter.scrapeMessages = async (id: string, _rounds: number, request: boolean) => {
    calls.push([id, request]);
    if (request) throw Error("X request conversation was not found");
    return { covered: true, messages: [{ id: "native", text: "Reply", direction: "in", timestamp: Date.now() }] };
  };
  await adapter.requestHistory("accepted", "", 0, 100, { inboxCategory: "spam" });
  assert.deepEqual(calls, [["accepted", true], ["accepted", false]]);
  assert.equal(saved[0].inboxCategory, "general");
  assert.equal(saved[0].historical, true);
  adapter.lastHistoryRequestAt = 0;
  calls.length = 0;
  adapter.scrapeMessages = async (id: string, _rounds: number, request: boolean) => { calls.push([id, request]); throw Error("X is cooling down"); };
  await assert.rejects(adapter.requestHistory("accepted", "", 0, 100, { inboxCategory: "spam" }), /cooling down/);
  assert.deepEqual(calls, [["accepted", true]]);
});

test("live replies are read without scrolling or waiting for a history repair", async () => {
  const { adapter, page, saved } = fixture();
  const row = conversation();
  adapter.scrapeConversations = async (...args: any[]) => {
    assert.deepEqual(args, [page, 0, "general", false]);
    return [row];
  };
  await adapter.syncLivePreviews();
  await adapter.syncLivePreviews();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body, "new reply");
  assert.equal(saved[0].historical, false);
  assert.equal(adapter.busy, true, "live reads must not release history ownership");
  assert.equal(adapter.automaticRepairQueue.get("general:live").live, true);
});

test("a stale successful-looking history result cannot mark the latest reply repaired", async () => {
  const { adapter, page, saved } = fixture();
  adapter.busy = false;
  adapter.chatPage = page;
  adapter.scrapeConversations = async () => [conversation("stale", "latest reply")];
  adapter.parkActionPage = async () => {};
  adapter.scrapeMessages = async (_id: string, _rounds: number, _request: boolean, _timeout: number, range: any) => {
    assert.equal(range.latest.preview, "latest reply");
    return { covered: true, messages: [{ id: "native", text: "older cached message", direction: "in", timestamp: Date.now() - 86400000 }] };
  };
  await assert.rejects(adapter.requestHistory("stale", "", 0, 100, { sinceTimestamp: Date.now() - 86400000 }), /latest inbox message has not loaded/);
  assert.equal(saved.length, 1, "retain available history without advancing the repair checkpoint");
});

test("history activates its own page before reading X's virtualized list", async () => {
  const { adapter } = fixture();
  let active = false;
  const at = Date.now();
  adapter.chatPage = {
    bringToFront: async () => { active = true; },
    waitForSelector: async () => {}, $: async () => null,
    evaluate: async () => null,
  };
  adapter.openGeneralConversation = async () => { assert.equal(active, true); };
  adapter.readMessageWindow = async () => [
    { id: "old", text: "earlier", direction: "in", timestamp: at - 86400000 },
    { id: "new", text: "latest reply", direction: "in", timestamp: at },
  ];
  const result = await adapter.scrapeMessages("test", 0, false, undefined, { count: 100, sinceTimestamp: at - 86400000, latest: { preview: "latest reply", direction: "in", timestamp: at } });
  assert.equal(result.covered, true);
  assert.equal(result.messages.length, 2);
});

test("live reads are single-flight and discard retired browser results", async () => {
  const { adapter, saved } = fixture();
  let release!: (rows: any[]) => void;
  adapter.scrapeConversations = () => new Promise(resolve => { release = resolve; });
  const first = adapter.syncLivePreviews();
  assert.equal(first, adapter.syncLivePreviews());
  adapter.lifecycleVersion++;
  release([conversation()]);
  await first;
  assert.equal(saved.length, 0);
  assert.equal(adapter.liveRead, undefined);
});

test("live reads respect cooldown, stopped state, and active sends", async () => {
  const { adapter } = fixture();
  adapter.scrapeConversations = () => { throw Error("must not read"); };
  adapter.inboxRetryAt = Date.now() + 60000;
  await adapter.syncLivePreviews();
  adapter.inboxRetryAt = 0;
  adapter.outboundPending = 1;
  await adapter.syncLivePreviews();
  adapter.outboundPending = 0;
  adapter.stopping = true;
  await adapter.syncLivePreviews();
});

test("overlapping preview writes deduplicate and failed writes can retry", async () => {
  const { adapter, saved } = fixture();
  const row = conversation();
  await Promise.all([1, 2].map(() => adapter.persistPreview(row, adapter.onMessage, false, () => true)));
  assert.equal(saved.length, 1);
  const failed = conversation("failed");
  await assert.rejects(adapter.persistPreview(failed, async () => { throw Error("database offline"); }, false, () => true));
  assert.equal(adapter.conversationPreviews.has("general:failed"), false);
  await adapter.persistPreview(failed, adapter.onMessage, false, () => true);
  assert.equal(saved.length, 2);
});

test("an unchanged inbox snapshot never becomes another event from a changed clock", async () => {
  const { adapter, saved } = fixture();
  const row = { ...conversation(), timeLabel: "10:07 AM", timestamp: Date.now() - 86400000 };
  await adapter.persistPreview(row, adapter.onMessage, false, () => true);
  await adapter.persistPreview({ ...row, timeLabel: "11:08 AM", timestamp: row.timestamp + 61 * 60000 }, adapter.onMessage, false, () => true);
  assert.equal(saved.length, 1);
  assert.ok(adapter.automaticRepairQueue.has("general:live"), "native history must still recover genuine identical repeats");
  await adapter.persistPreview({ ...row, preview: "A different new reply" }, adapter.onMessage, false, () => true);
  assert.equal(saved.length, 2, "different content is never dropped");
});

test("fresh replies take priority over the old daily audit at the same network pace", async () => {
  const { adapter } = fixture();
  adapter.busy = false;
  adapter.enqueueAutomaticRepair({ ...conversation("old"), timestamp: Date.now() - 86400000 }, true);
  adapter.enqueueAutomaticRepair(conversation("fresh"));
  const repairs: string[] = [];
  adapter.requestHistory = async (id: string) => { repairs.push(id); };
  const before = Date.now();
  await adapter.processAutomaticRepair();
  assert.deepEqual(repairs, ["fresh"]);
  assert.ok(adapter.automaticRepairQueue.has("general:old"));
  assert.ok(adapter.automaticRepairNextAt >= before + 60000);
});

test("media recovery stays queued until every preview has a local attachment", async () => {
  const { adapter } = fixture();
  adapter.busy = false;
  adapter.automaticRepairQueue.set("general:media", {
    id: "media", name: "Media", inboxCategory: "general", previewKey: "media-recovery",
    attempts: 0, mediaRecovery: true, imageRecovery: true, sinceTimestamp: Date.now() - 86400000,
  });
  adapter.requestHistory = async () => {};
  adapter.mediaRecoveryComplete = async () => false;
  await adapter.processAutomaticRepair();
  assert.equal(adapter.automaticRepairQueue.has("general:media"), true);
  adapter.mediaRecoveryComplete = async () => true;
  await adapter.processAutomaticRepair();
  assert.equal(adapter.automaticRepairQueue.has("general:media"), false);
});

for (const fails of [false, true]) {
  test(`a reply arriving during ${fails ? "failed" : "successful"} repair is not dropped`, async () => {
    const { adapter } = fixture();
    adapter.busy = false;
    adapter.enqueueAutomaticRepair(conversation());
    adapter.requestHistory = async () => {
      adapter.enqueueAutomaticRepair(conversation("live", "second reply"));
      if (fails) throw Error("history interrupted");
    };
    await adapter.processAutomaticRepair();
    assert.match(adapter.automaticRepairQueue.get("general:live").previewKey, /second reply/);
  });
}

test("new activity during a repair cannot start another early pacing timer", async () => {
  const { adapter } = fixture();
  adapter.busy = false;
  adapter.enqueueAutomaticRepair(conversation());
  adapter.scheduleAutomaticRepair = (XAdapter.prototype as any).scheduleAutomaticRepair;
  adapter.requestHistory = async () => {
    assert.equal(adapter.automaticRepairRunning, true);
    adapter.enqueueAutomaticRepair(conversation("another"));
    assert.equal(adapter.automaticRepairTimer, undefined);
    await adapter.processAutomaticRepair(); // no overlapping second history request
  };
  try {
    await adapter.processAutomaticRepair();
    assert.equal(adapter.automaticRepairRunning, false);
    assert.ok(adapter.automaticRepairTimer);
    assert.ok(adapter.automaticRepairNextAt > Date.now() + 59000);
  } finally {
    clearTimeout(adapter.automaticRepairTimer);
  }
});
