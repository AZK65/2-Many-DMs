import assert from "node:assert/strict";
import { test } from "node:test";
import { XAdapter } from "./adapters/x";
import { isXRateLimitRelevant, xRateLimitTransition, xRetryDeadline } from "./x-rate-limit";

test("server retry deadlines accept seconds and HTTP dates without allowing invalid or past dates", () => {
  const now = Date.parse("2026-10-06T16:00:00Z");
  assert.equal(xRetryDeadline({ "retry-after": "120" }, now), now + 120000);
  assert.equal(xRetryDeadline({ "retry-after": "Tue, 06 Oct 2026 16:05:00 GMT" }, now), now + 300000);
  assert.equal(xRetryDeadline({ "x-rate-limit-reset": String((now + 600000) / 1000), "retry-after": "120" }, now), now + 600000);
  assert.equal(xRetryDeadline({ "retry-after": "invalid", "x-rate-limit-reset": "NaN" }, now), 0);
  assert.equal(xRetryDeadline({ "retry-after": "Tue, 06 Oct 2026 15:00:00 GMT" }, now), 0);
});

test("late 429s during one incident cannot keep escalating the local cooldown", () => {
  const now = 1000000;
  const first = xRateLimitTransition({ retryAt: 0, failures: 0 }, 0, now);
  assert.equal(first.failures, 1);
  let result = first;
  for (let minute = 1; minute < 15; minute += 1) {
    result = xRateLimitTransition(result, 0, now + minute * 60000);
    assert.equal(result.retryAt, first.retryAt);
    assert.equal(result.failures, 1);
    assert.equal(result.newStrike, false);
  }
  const serverExtension = xRateLimitTransition(result, first.retryAt + 60000, now + 800000);
  assert.equal(serverExtension.retryAt, first.retryAt + 60000);
  assert.equal(serverExtension.failures, 1);
  const failedRecovery = xRateLimitTransition(serverExtension, 0, serverExtension.retryAt + 1);
  assert.equal(failedRecovery.failures, 2);
  assert.equal(failedRecovery.retryAt, serverExtension.retryAt + 1 + 30 * 60000);
});

test("telemetry throttles do not disable DMs", () => {
  assert.equal(isXRateLimitRelevant("https://x.com/i/api/1.1/jot/client_event.json", "fetch"), false);
  assert.equal(isXRateLimitRelevant("https://x.com/i/api/graphql/hash/ViewerBadgeCounts", "fetch"), false);
  assert.equal(isXRateLimitRelevant("https://x.com/i/api/graphql/hash/FetchInbox", "fetch"), true);
  assert.equal(isXRateLimitRelevant("https://api.x.com/2/dm_events", "xhr"), true);
  assert.equal(isXRateLimitRelevant("https://x.com/i/chat", "document"), true);
  assert.equal(isXRateLimitRelevant("https://example.com/i/chat", "document"), false);
  assert.equal(isXRateLimitRelevant("https://x.com/image", "image"), false);
});

function connectorHarness() {
  // No browser, disk writes, credentials, or network are used by these tests.
  const adapter = new XAdapter() as any;
  const browser = { connected: true };
  const pages = Array.from({ length: 4 }, () => {
    let url = "https://x.com/i/chat";
    return {
      navigations: [] as string[],
      url: () => url,
      isClosed: () => false,
      browser: () => browser,
      $: async () => null,
      goto: async function (target: string) { this.navigations.push(target); url = target; },
    };
  });
  [adapter.page, adapter.requestPage, adapter.chatPage, adapter.sendPage] = pages;
  adapter.browser = browser;
  adapter.state = "ready";
  adapter.persistRateLimitCooldown = () => {};
  adapter.persistRepairState = () => {};
  return { adapter, pages };
}

test("unchanged X previews get a daily history audit without duplicate jobs or bypassing cooldowns", () => {
  const { adapter } = connectorHarness();
  adapter.scheduleAutomaticRepair = () => {};
  const chat = { id: "daily-chat", name: "Daily", handle: "daily", inboxCategory: "general", preview: "hello", direction: "in", timestamp: Date.now() };
  const key = "general:daily-chat";
  adapter.repairedPreviews.set(key, `in:hello:${chat.timestamp}`);
  adapter.lastRepairAt.set(key, Date.now());
  adapter.enqueueAutomaticRepair(chat);
  assert.equal(adapter.automaticRepairQueue.size, 0);
  adapter.lastRepairAt.set(key, Date.now() - 24 * 60 * 60_000 - 1);
  adapter.enqueueAutomaticRepair(chat);
  assert.equal(adapter.automaticRepairQueue.size, 1);
  adapter.enqueueAutomaticRepair(chat, true);
  assert.equal(adapter.automaticRepairQueue.size, 1);
  adapter.automaticRepairQueue.clear();
  adapter.repairRetryAt.set(key, Date.now() + 60_000);
  adapter.enqueueAutomaticRepair(chat, true);
  assert.equal(adapter.automaticRepairQueue.size, 0);
});

test("a rate limit parks every live route, blocks sends, and reports paused instead of ready", async () => {
  const { adapter, pages } = connectorHarness();
  adapter.markRateLimited();
  await adapter.cooldownParkPromise;
  assert.ok(pages.every((page) => page.url() === "about:blank"));
  assert.equal(adapter.getStatus().state, "starting");
  await assert.rejects(adapter.ensureReady(), /cooling down/);
  const originalDeadline = adapter.inboxRetryAt;
  adapter.markRateLimited();
  await adapter.cooldownParkPromise;
  assert.equal(adapter.rateLimitFailures, 1);
  assert.equal(adapter.inboxRetryAt, originalDeadline);
  assert.ok(pages.every((page) => page.navigations.length === 1));
  adapter.connect = async () => { throw new Error("must not relaunch during cooldown"); };
  await adapter.recover();
});

test("cooldown permits an already-clicked send to finish confirmation, then parks its routes", async () => {
  const { adapter, pages } = connectorHarness();
  adapter.outboundPending = 1;
  adapter.markRateLimited();
  await adapter.cooldownParkPromise;
  assert.equal(pages[0].url(), "about:blank");
  assert.equal(pages[2].url(), "about:blank");
  assert.equal(pages[1].url(), "https://x.com/i/chat");
  assert.equal(pages[3].url(), "https://x.com/i/chat");
  adapter.outboundPending = 0;
  await adapter.parkForCooldown();
  assert.ok(pages.every((page) => page.url() === "about:blank"));
});

test("a 429 during a request send does not reload Requests when the send settles", async () => {
  const { adapter, pages } = connectorHarness();
  (pages[3] as any).$ = async () => ({}); // Request already promoted to General.
  adapter.openGeneralConversation = async () => {};
  const sent = { messageExternalId: "x:confirmed", timestamp: new Date().toISOString() };
  adapter.sendFromOpenConversation = async () => {
    adapter.markRateLimited();
    return sent; // The original send was confirmed; it must not be replayed.
  };
  const result = await adapter.send("test-chat", "hello", undefined, undefined, undefined, { inboxCategory: "spam" });
  await adapter.cooldownParkPromise;
  assert.equal(result, sent);
  assert.deepEqual(pages[1].navigations, ["about:blank"]);
  assert.ok(pages.every((page) => page.url() === "about:blank"));
});

test("a 429 while opening the composer stops the fallback reload", async () => {
  const { adapter, pages } = connectorHarness();
  const page = pages[3] as any;
  page.evaluate = async () => false;
  const navigate = page.goto.bind(page);
  page.goto = async (target: string) => {
    await navigate(target);
    adapter.inboxRetryAt = Date.now() + 60000;
  };
  page.reload = async () => { assert.fail("must not reload a throttled composer"); };
  await assert.rejects(adapter.openGeneralConversation(page, "test-chat"), /cooling down/);
  assert.deepEqual(page.navigations, ["https://x.com/i/chat/test-chat"]);
});

test("status checks detect a dead browser and schedule only one recovery", () => {
  const { adapter } = connectorHarness();
  adapter.browser.connected = false;
  try {
    assert.equal(adapter.getStatus().state, "disconnected");
    const firstTimer = adapter.reconnectTimer;
    assert.ok(firstTimer);
    adapter.getStatus();
    assert.equal(adapter.reconnectTimer, firstTimer);
    assert.equal(adapter.reconnectFailures, 1);
  } finally {
    clearTimeout(adapter.reconnectTimer);
  }
});

test("repeatedly timing-out repairs remain durable but pause without blocking other chats", async () => {
  const { adapter } = connectorHarness();
  const attempted: string[] = [];
  adapter.scheduleAutomaticRepair = () => {};
  adapter.requestHistory = async (id: string) => {
    attempted.push(id);
    throw new Error("History load timed out");
  };
  for (const id of ["first", "second"]) {
    adapter.automaticRepairQueue.set(id, { id, name: id, inboxCategory: "general", previewKey: "in:hello", attempts: 0 });
  }
  for (let attempt = 0; attempt < 8; attempt += 1) await adapter.processAutomaticRepair();
  assert.deepEqual(attempted, ["first", "second", "first", "second", "first", "second"]);
  assert.equal(adapter.automaticRepairQueue.size, 2);
  for (const id of ["first", "second"]) {
    assert.ok(adapter.repairRetryAt.get(id) > Date.now() + 5 * 60 * 60 * 1000);
    assert.equal(adapter.automaticRepairQueue.get(id).attempts, 0);
  }
  await adapter.processAutomaticRepair();
  assert.equal(attempted.length, 6, "paused work must not make another network attempt");
});

test("cooldown expiry recovers and unlocks General before waiting for messages, then restores Requests on the next poll", async () => {
  const { adapter, pages } = connectorHarness();
  await Promise.all(pages.map((page) => page.goto("about:blank")));
  for (const page of pages) page.navigations.length = 0;
  adapter.inboxRetryAt = Date.now() - 1;
  adapter.rateLimitUntil = adapter.inboxRetryAt;
  adapter.detail = "X inbox paused";
  adapter.scrapeConversations = async () => [];
  const events: string[] = [];
  let unlocked = false;
  (pages[1] as any).$ = async () => null;
  (pages[0] as any).$ = async () => unlocked ? {} : null;
  (pages[0] as any).waitForSelector = async () => {
    events.push("wait for inbox");
    assert.equal(unlocked, true, "the list cannot exist before the passcode is unlocked");
  };
  adapter.unlockBackgroundPage = async (_page: unknown, label: string) => {
    events.push(`unlock ${label}`);
    if (label === "inbox") unlocked = true;
    return true;
  };
  await adapter.sync(async () => {});
  assert.deepEqual(events, ["unlock inbox", "wait for inbox"]);
  assert.deepEqual(pages[0].navigations, ["https://x.com/i/chat"]);
  assert.equal(pages[1].url(), "about:blank", "do not start two encrypted inboxes in one recovery burst");
  assert.equal(adapter.inboxRetryAt, 0);
  assert.equal(adapter.rateLimitUntil, 0);
  assert.equal(adapter.getStatus().state, "ready");
  assert.equal(adapter.detail, undefined);

  // The next scheduled poll is a minute later; advance only the pacing marker
  // so the test exercises the real recovery path without a minute-long sleep.
  adapter.lastInboxNavigationAt = Date.now() - 60000;
  await adapter.sync(async () => {});
  assert.deepEqual(pages[1].navigations, ["https://x.com/i/chat/requests"]);
  assert.equal(events.at(-1), "unlock requests");
  assert.deepEqual(pages[0].navigations, ["https://x.com/i/chat"], "healthy General must not be reloaded");
});
