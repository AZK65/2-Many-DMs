import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { XAdapter } from "./adapters/x";
import { mergeXHistory, orderXMinuteMessages, parseXDate, stableXInboxDate, xInboxDateIsEstimate, xSnowflakeDate, xHistoryMatchesPreview } from "./x-history";

const now = new Date(2026, 9, 7, 16, 0).getTime();
test("X dates come from the platform, never the import clock", () => {
  assert.equal(parseXDate("Oct 2, 2026", now), new Date(2026, 9, 2).getTime());
  assert.equal(parseXDate("4:39 PM", now, "Sep 2, 2026"), new Date(2026, 8, 2, 16, 39).getTime());
  assert.equal(parseXDate("4:39 PM", now), null);
  assert.equal(parseXDate("hello October 2", now), null);
  assert.equal(parseXDate("25:65 PM", now, "Today"), null);
  assert.equal(parseXDate("2027-01-01T00:00:00Z", now), null);
  assert.equal(parseXDate("Dec 31", new Date(2026, 0, 2).getTime()), new Date(2025, 11, 31).getTime());
  assert.equal(parseXDate("2h", now), now - 7200000);
  assert.equal(parseXDate("Thu, Jan 29 at 4:12 PM", now), new Date(2026, 0, 29, 16, 12).getTime());
  assert.equal(parseXDate("Today 12:11 AM", now), new Date(2026, 9, 7, 0, 11).getTime());
  assert.equal(parseXDate("10:19 PM", now, "Mon, Feb 2 at 10:09 PM"), new Date(2026, 1, 2, 22, 19).getTime());
  assert.equal(parseXDate("Friday at 4:49 AM", now), new Date(2026, 9, 2, 4, 49).getTime());
  assert.equal(parseXDate("4:54 PM", now, "Tuesday"), new Date(2026, 9, 6, 16, 54).getTime());
});
test("UUIDv4 is not a timestamp; legacy snowflakes can be decoded", () => {
  assert.equal(xSnowflakeDate("540fd02d-d354-4977-9cb1-4cb177fcbaf8", now), null);
  const date = Date.parse("2026-09-21T15:00:00Z");
  const id = ((BigInt(date) - 1288834974657n) << 22n).toString();
  assert.equal(xSnowflakeDate(id, now), date);
});
test("relative inbox labels do not manufacture new activity on each poll", () => {
  for (const label of ["now", "4m", "2 hours ago", "1 minute", "3 days ago", " 5w "]) assert.equal(xInboxDateIsEstimate(label), true, label);
  for (const label of ["", "9:44 PM", "Oct 29, 2026", "2026-10-29T21:44:00Z"]) assert.equal(xInboxDateIsEstimate(label), false, label);
  assert.equal(stableXInboxDate("1 minute ago", now + 64027, now), now);
  const original = now - 7 * 3600000;
  assert.equal(stableXInboxDate("7h", original + 60000, original), original);
  assert.equal(stableXInboxDate("now", now, original), now);
  assert.equal(stableXInboxDate("now", now + 60027, now), now);
  assert.equal(stableXInboxDate("1m", now + 64254, now), now);
  assert.equal(stableXInboxDate("1m", now - 45000, now), now);
  assert.equal(stableXInboxDate("now", now + 600000, now), now + 600000);
});
test("old history or the wrong direction cannot verify the latest inbox preview", () => {
  const preview = { preview: "💀", direction: "in" as const, timestamp: now };
  const native = { id: "native", text: "💀", direction: "in" as const, timestamp: now - 16000 };
  assert.equal(xHistoryMatchesPreview([native], preview), true);
  assert.equal(xHistoryMatchesPreview([{ ...native, timestamp: now - 86400000 }], preview), false);
  assert.equal(xHistoryMatchesPreview([{ ...native, direction: "out" }], preview), false);
  assert.equal(xHistoryMatchesPreview([{ ...native, text: "old cached text" }], preview), false);
  assert.equal(xHistoryMatchesPreview([{ ...native, text: "", attachments: [{ url: null, type: "image" }] }], { ...preview, preview: "Sent a photo" }), true);
});
test("history accumulates every virtualized window and deduplicates by native ID", () => {
  const m = (id: string, timestamp: number) => ({ id, timestamp, text: "same repeated text", direction: "in" as const });
  const rows = mergeXHistory([[m("c", 3), m("d", 4)], [m("b", 2), m("c", 3)], [m("a", 1), m("b", 2)]]);
  assert.deepEqual(rows.map((m) => m.id), ["a", "b", "c", "d"]);
});

test("full replies replace truncated native windows, never the reverse", () => {
  const base = { id: "native", timestamp: now, direction: "in" as const };
  const short = { ...base, text: "Here is the complete information…" };
  const full = { ...base, text: "Here is the complete information you requested. Meet at 5:30 PM" };
  for (const windows of [[[short], [full]], [[full], [short]]]) {
    assert.equal(mergeXHistory(windows)[0].text, full.text);
  }
  const preview = { preview: short.text, timestamp: now, direction: "in" as const };
  assert.equal(xHistoryMatchesPreview([full], preview), true);
  assert.equal(xHistoryMatchesPreview([{ ...full, timestamp: now - 86400000 }], preview), false);
  assert.equal(xHistoryMatchesPreview([{ ...full, direction: "out" }], preview), false);
  assert.equal(xHistoryMatchesPreview([{ ...full, text: "yes please" }], { ...preview, preview: "yes" }), false);
});
test("minute-precision bubbles keep their native order, independently of preview insertion order", () => {
  const rows = orderXMinuteMessages(["yo bro", "credit card", "waitlist", "how can I get it?"].map((text, i) => ({ id: String(i), text, direction: "in" as const, timestamp: now, minutePrecision: true })));
  assert.deepEqual(rows.map(row => row.timestamp), [now, now + 1, now + 2, now + 3]);
  assert.equal(orderXMinuteMessages([{ id: "exact", text: "sent locally", direction: "out", timestamp: now + 8065 }])[0].timestamp, now + 8065);
});

test("repair progress, dates, and deferred work survive a worker restart", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "omni-x-checkpoint-test-"));
  const originalDirectory = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    // Exercise persistence only: no browser, network, or user state involved.
    const before = new XAdapter() as any;
    before.automaticRepairQueue.set("general:pending", { id: "pending", name: "Test", inboxCategory: "general", previewKey: "in:test:1", attempts: 1 });
    before.repairedPreviews.set("general:done", "in:done:2");
    before.lastRepairAt.set("general:done", now);
    before.inboxDates.set("general:pending", { preview: "in:test", timestamp: now });
    before.repairRetryAt.set("general:deferred", now + 3600000);
    before.discoveryOffsets = { general: 1000, spam: 2000 };
    before.persistRepairState();
    const after = new XAdapter() as any;
    after.loadRepairState();
    assert.deepEqual([...after.automaticRepairQueue], [...before.automaticRepairQueue]);
    assert.deepEqual([...after.repairedPreviews], [...before.repairedPreviews]);
    assert.deepEqual([...after.lastRepairAt], [...before.lastRepairAt]);
    assert.deepEqual([...after.inboxDates], [...before.inboxDates]);
    assert.deepEqual([...after.repairRetryAt], [...before.repairRetryAt]);
    assert.deepEqual(after.discoveryOffsets, before.discoveryOffsets);
  } finally {
    if (originalDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});
