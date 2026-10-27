import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TelegramHistorySync } from "./telegram-history-sync";

function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), "omni-tg-history-"));
  const file = path.join(directory, "checkpoints.json");
  let time = Date.parse("2026-10-13T16:00:00Z");
  let latest = 325;
  let connected = true;
  let calls = 0;
  const saved = new Set<number>();
  const options = {
    file, now: () => time, pause: async () => {}, maxPages: 1,
    ready: () => connected, beforePage: async () => {},
    list: async () => [{ id: "test-chat", latestId: latest, entity: {} }],
    fetch: async (_: unknown, o: { limit: number; offsetId: number; minId: number; maxId: number }) => {
      calls++;
      return Array.from({ length: latest }, (_, i) => ({ id: latest - i, date: Math.floor(time / 1000) - (latest - i) }))
        .filter(m => m.id < o.maxId && m.id > o.minId && (!o.offsetId || m.id < o.offsetId)).slice(0, o.limit);
    },
    save: async (_: unknown, message: { id: number }) => { saved.add(message.id); },
  };
  return { options, saved, calls: () => calls, advance: (ms: number) => { time += ms; }, latest: (id: number) => { latest = id; }, connected: (value: boolean) => { connected = value; }, state: () => JSON.parse(readFileSync(file, "utf8")), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("Telegram fills more than one page and resumes its exact gap after restart", async () => {
  const h = harness();
  try {
    await new TelegramHistorySync(h.options).run();
    assert.equal(h.saved.size, 100);
    assert.equal(h.state().chats["test-chat"].highId, 0);
    assert.equal(h.state().chats["test-chat"].pending.offsetId, 226);
    h.latest(330); // New messages cannot move the unfinished gap boundary.
    const resumed = new TelegramHistorySync(h.options);
    await resumed.run(); await resumed.run(); await resumed.run();
    assert.equal(h.saved.size, 325);
    assert.equal(h.state().chats["test-chat"].highId, 325);
    await resumed.run();
    assert.equal(h.saved.size, 330);
    const calls = h.calls();
    await resumed.run();
    assert.equal(h.calls(), calls, "unchanged chats do not reload between daily audits");
    h.advance(24 * 60 * 60_000 + 1);
    await resumed.run();
    assert.equal(h.calls(), calls + 1, "daily verification checks even an unchanged latest ID");
  } finally { h.cleanup(); }
});

test("Telegram never checkpoints an incomplete database write", async () => {
  const h = harness();
  try {
    let writes = 0;
    const broken = new TelegramHistorySync({ ...h.options, save: async () => { if (++writes === 3) throw new Error("database unavailable"); } });
    await broken.run();
    assert.equal(h.state().chats["test-chat"].highId, 0);
    assert.equal(h.state().chats["test-chat"].pending.offsetId, 0);
    h.advance(15 * 60_000 + 1);
    await new TelegramHistorySync(h.options).run();
    assert.equal(h.saved.size, 100);
  } finally { h.cleanup(); }
});

test("Telegram respects persisted flood waits and disconnects", async () => {
  const h = harness();
  try {
    const blocked = new TelegramHistorySync({ ...h.options, fetch: async () => { throw Object.assign(new Error("FLOOD_WAIT_3600"), { seconds: 3600 }); } });
    await blocked.run();
    const resumed = new TelegramHistorySync(h.options);
    await resumed.run();
    assert.equal(h.calls(), 0);
    h.advance(3600_001);
    h.connected(false); await resumed.run(); assert.equal(h.calls(), 0);
    h.connected(true); await resumed.run(); assert.equal(h.calls(), 1);
    resumed.stop(); await resumed.run(); assert.equal(h.calls(), 1);
  } finally { h.cleanup(); }
});

test("Telegram catch-up is single flight and old chats get a small readable baseline", async () => {
  const h = harness();
  try {
    const worker = new TelegramHistorySync({ ...h.options, fetch: async () => Array.from({ length: 50 }, (_, i) => ({ id: 50 - i, date: 1 })) });
    const first = worker.run();
    assert.equal(worker.run(), first);
    await first;
    assert.equal(h.saved.size, 20);
  } finally { h.cleanup(); }
});

test("descending pages advance with GramJS max(offsetId, maxId) semantics", async () => {
  const h = harness();
  try {
    const worker = new TelegramHistorySync({ ...h.options, fetch: async (_entity, options) => {
      const offset = Math.max(options.offsetId, options.maxId);
      return Array.from({ length: 325 }, (_, i) => ({ id: 325 - i, date: 1_792_000_000 }))
        .filter(m => m.id < offset && m.id > options.minId).slice(0, options.limit);
    } });
    await worker.run();
    assert.equal(worker.getStatus().pendingChats, 1);
    await worker.run(); await worker.run(); await worker.run();
    assert.equal(h.saved.size, 325);
    assert.equal(worker.getStatus().pendingChats, 0);
    assert.equal(worker.getStatus().blockedChats, 0);
    assert.equal(h.state().chats["test-chat"].highId, 325);
  } finally { h.cleanup(); }
});
