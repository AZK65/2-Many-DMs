import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { EventEmitter as BrowserEventEmitter } from "puppeteer-core";
import test from "node:test";
import { WhatsAppAdapter } from "./whatsapp";

test("recent catch-up is single-flight, cache-only, historical and skips unchanged chats", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let fetches = 0;
  const saved: any[] = [];
  const now = Math.floor(Date.now() / 1000);
  const chat = {
    id: { _serialized: "123@g.us" }, timestamp: now, unreadCount: 1,
    fetchMessages: async (options: any) => {
      assert.deepEqual(options, { limit: 0 });
      fetches++;
      return [{ timestamp: now - 4 * 86400, id: { id: "old" } }, { timestamp: now, id: { id: "recent" } }, { timestamp: now }];
    },
  };
  Object.assign(client, { getChats: async () => [chat], getContacts: async () => [] });
  Object.assign(adapter, {
    client, state: "ready", onMessage: async (message: any) => { saved.push(message); },
    readCachedChats: () => (client as any).getChats(),
    toInbound: async (_message: any, options: any) => {
      assert.deepEqual(options, { downloadMedia: false, downloadAvatar: false, resolveQuoted: false });
      return { body: "recent" };
    },
  });
  const first = (adapter as any).reconcileRecentMessages();
  assert.equal(first, (adapter as any).reconcileRecentMessages());
  await first;
  assert.deepEqual(saved, [{ body: "recent", historical: true }]);
  await (adapter as any).reconcileRecentMessages();
  assert.equal(fetches, 1);
  chat.timestamp++;
  await (adapter as any).reconcileRecentMessages();
  assert.equal(fetches, 2);
  assert.equal(saved.length, 1, "a changed chat must not reimport already processed messages or unstable IDs");
});

test("WhatsApp metadata repairs old chats and resolves senders without repeated lookups", async () => {
  const updates: any[] = [];
  const adapter = new WhatsAppAdapter({ onIdentities: async (rows) => { updates.push(...rows); } });
  const client = browserClient();
  Object.assign(client, {
    getChats: async () => [{ id: { _serialized: "123@g.us" }, name: "Example x Team", timestamp: 1 }],
    getContacts: async () => [{ id: { _serialized: "456@lid" }, name: "Saved Alice", pushname: "Alice" }],
    getChatById: async () => { throw Error("lookup should use cached metadata"); },
    getContactById: async () => { throw Error("lookup should use cached metadata"); },
  });
  Object.assign(adapter, { client, state: "ready", onMessage: async () => {}, readCachedChats: () => (client as any).getChats() });
  await (adapter as any).reconcileRecentMessages();
  assert.equal(updates.find(row => row.externalKey === "whatsapp:123@g.us").name, "Example x Team");
  const result = await (adapter as any).toInbound({
    id: { id: "fixture" }, from: "123@g.us", to: "999@c.us", fromMe: false,
    author: "456@lid", body: "Hello", timestamp: Date.now() / 1000, type: "chat",
  }, { downloadAvatar: false });
  assert.equal(result.contact.name, "Example x Team");
  assert.equal(result.sender.name, "Saved Alice");
});

test("recent catch-up does not persist from a retired client or interfere with sends", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let reads = 0;
  Object.assign(client, { getChats: async () => {
    reads++;
    Object.assign(adapter, { client: browserClient() });
    return [{ id: { _serialized: "123@g.us" }, timestamp: Date.now() / 1000 }];
  } });
  Object.assign(adapter, {
    client, state: "ready", activeSends: 1,
    readCachedChats: () => (client as any).getChats(),
    onMessage: async () => { assert.fail("retired client persisted a message"); },
  });
  await (adapter as any).reconcileRecentMessages();
  assert.equal(reads, 0);
  Object.assign(adapter, { activeSends: 0 });
  await (adapter as any).reconcileRecentMessages();
  assert.equal(reads, 1);
});

test("QR refresh clears the old image, waits for a different code, and coalesces clicks", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let requests = 0;
  let deliver!: () => void;
  Object.assign(client.pupPage, { evaluate: () => {
    requests++;
    return new Promise<void>((resolve) => { deliver = resolve; });
  } });
  Object.assign(adapter, { client, state: "qr", qr: "old-code" });
  const first = adapter.refreshQr();
  const second = adapter.refreshQr();
  assert.equal(first, second);
  assert.equal(adapter.getStatus().qr, null);
  assert.equal(requests, 1);
  Object.assign(adapter, { qr: "fresh-code" });
  deliver();
  await first;
  assert.equal(adapter.getStatus().qr, "fresh-code");
  await assert.rejects(adapter.refreshQr(), /wait a few seconds/);
});

test("QR refresh never resets an authenticated account or a send", async () => {
  const adapter = new WhatsAppAdapter();
  for (const state of ["ready", "starting", "disconnected", "disabled"]) {
    Object.assign(adapter, { state });
    await assert.rejects(adapter.refreshQr(), /no longer waiting/);
  }
});

test("failed QR requests hide the stale image and release refresh ownership", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  Object.assign(client.pupPage, { evaluate: async () => { throw new Error("network unavailable"); } });
  Object.assign(adapter, { client, state: "qr", qr: "old-code" });
  await assert.rejects(adapter.refreshQr(), /network unavailable/);
  assert.equal(adapter.getStatus().qr, null);
  assert.equal((adapter as any).qrRefreshPromise, undefined);
});

test("missing native QR refresh reopens only the unlinked client without deleting its session", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  const replacement = browserClient();
  let destroyed = 0;
  client.destroy = async () => { destroyed++; };
  Object.assign(client.pupPage, { evaluate: async () => false });
  Object.assign(adapter, {
    client, state: "qr", qr: "old-code",
    connect: async () => { Object.assign(adapter, { client: replacement, state: "qr", qr: "new-code" }); },
  });
  await adapter.refreshQr();
  assert.equal(destroyed, 1);
  assert.equal(adapter.getStatus().qr, "new-code");
});

test("a phone scan during a QR request prevents fallback browser teardown", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let destroyed = 0;
  client.destroy = async () => { destroyed++; };
  Object.assign(client.pupPage, { evaluate: async () => {
    Object.assign(adapter, { state: "starting", syncTriggered: true });
    return false;
  } });
  Object.assign(adapter, { client, state: "qr", qr: "old-code" });
  await adapter.refreshQr();
  assert.equal(destroyed, 0);
  assert.equal(adapter.getStatus().state, "starting");
});

test("linking the phone hides the QR and ignores late QR events", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  Object.assign(client.pupPage, { evaluate: async () => {} });
  Object.assign(adapter, { client, state: "qr", qr: "old-code", onMessage: async () => {} });
  (adapter as any).attachHandlers(client);
  client.emit("authenticated");
  client.emit("qr", "late-code");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "starting");
  assert.equal(adapter.getStatus().qr, null);
});

function browserClient() {
  const browser = Object.assign(new EventEmitter(), {
    isConnected: (): boolean => true,
    close: async () => {},
  });
  const page = Object.assign(new BrowserEventEmitter<any>(), { isClosed: () => false });
  return Object.assign(new EventEmitter(), {
    pupBrowser: browser,
    pupPage: page,
    destroy: async () => {},
  });
}

test("authentication does not recursively invoke the library's initialization callback", () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  Object.assign(client.pupPage, { evaluate: () => assert.fail("authentication must not re-enter initialization") });
  Object.assign(adapter, { client, state: "qr", onMessage: async () => {} });
  (adapter as any).attachHandlers(client);
  client.emit("authenticated");
  client.emit("authenticated");
  assert.equal(adapter.getStatus().state, "starting");
});

test("main-document reload clears readiness before native injection and can become ready again", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  const frame = { url: () => "https://web.whatsapp.com/" };
  Object.assign(client, { _readyEmitted: true, _authEventListenersInjected: true });
  Object.assign(client.pupPage, { mainFrame: () => frame });
  Object.assign(adapter, {
    client, state: "ready", syncTriggered: true, readyDone: true, onMessage: async () => {},
    installWebCompatibilityPatches: async () => {}, reconcileRecentMessages: async () => {}, backfill: async () => {},
  });
  // Simulate the library registering its listener before our watcher.
  let nativeInjection!: Promise<void>;
  client.pupPage.on("framenavigated", () => {
    // Native inject starts with an asynchronous page evaluation.
    nativeInjection = Promise.resolve().then(() => {
      assert.equal((client as any)._readyEmitted, false);
      assert.equal((client as any)._authEventListenersInjected, false);
      assert.equal(adapter.getStatus().state, "starting");
    });
  });
  (adapter as any).attachHandlers(client);
  (adapter as any).watchBrowser(client);
  client.pupPage.emit("framenavigated", frame);
  await nativeInjection;
  client.emit("authenticated");
  client.emit("ready");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "ready");
});

test("iframe navigation, retired pages and explicit logout do not reset native readiness", () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let url = "https://web.whatsapp.com/";
  const frame = { url: () => url };
  Object.assign(client, { _readyEmitted: true });
  Object.assign(client.pupPage, { mainFrame: () => frame });
  Object.assign(adapter, { client, state: "ready" });
  (adapter as any).watchBrowser(client);
  client.pupPage.emit("framenavigated", { url: () => "https://web.whatsapp.com/iframe" });
  assert.equal((client as any)._readyEmitted, true);
  url = "https://web.whatsapp.com/?post_logout=1";
  client.pupPage.emit("framenavigated", frame);
  assert.equal((client as any)._readyEmitted, true);
  url = "https://web.whatsapp.com/";
  Object.assign(client, { lastLoggedOut: true });
  client.pupPage.emit("framenavigated", frame);
  assert.equal((client as any)._readyEmitted, true);
  Object.assign(client, { lastLoggedOut: false });
  Object.assign(adapter, { client: browserClient() });
  client.pupPage.emit("framenavigated", frame);
  assert.equal((client as any)._readyEmitted, true);
});

test("reload invalidates an old ready callback and accepts a genuine new QR", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  const frame = { url: () => "https://web.whatsapp.com/" };
  let finish!: () => void;
  Object.assign(client.pupPage, { mainFrame: () => frame });
  Object.assign(adapter, {
    client, state: "starting", onMessage: async () => {},
    installWebCompatibilityPatches: () => new Promise<void>(resolve => { finish = resolve; }),
  });
  (adapter as any).attachHandlers(client);
  (adapter as any).watchBrowser(client);
  client.emit("ready");
  client.pupPage.emit("framenavigated", frame);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "starting");
  client.emit("qr", "test-only-qr");
  assert.equal(adapter.getStatus().state, "qr");
});

test("automatic chat inventory uses only cached metadata and never hydrates every group", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  const previousWindow = (globalThis as any).window;
  const forbidden = () => { throw new Error("network hydration must not run"); };
  (globalThis as any).window = { Store: { Chat: { getModelsArray: () => [
    { id: { _serialized: "123@g.us" }, formattedTitle: "Team", unreadCount: 2, t: 4,
      groupMetadata: { update: forbidden }, serialize: forbidden,
      msgs: { getModelsArray: () => [{ t: 9 }] } },
    { id: { _serialized: "456@c.us" }, name: "Alice", t: 8 },
    { id: { _serialized: "status@broadcast" }, serialize: forbidden },
  ] }, GroupMetadata: { update: forbidden } } };
  Object.assign(client.pupPage, { evaluate: async (read: () => unknown) => read() });
  Object.assign(client, { getChats: forbidden });
  try {
    const chats = await (adapter as any).readCachedChats(client);
    assert.equal(chats.length, 2);
    assert.equal(chats[0].name, "Team");
    assert.equal(chats[0].timestamp, 9);
    assert.equal(chats[0].unreadCount, 2);
    assert.equal(chats[0].isGroup, true);
    assert.equal(typeof chats[0].fetchMessages, "function");
    assert.equal(chats[1].name, "Alice");
  } finally { (globalThis as any).window = previousWindow; }
});

test("a still-running browser inventory cannot be duplicated by a retry", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let finish!: (rows: unknown[]) => void;
  let calls = 0;
  Object.assign(client.pupPage, { evaluate: () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } });
  const first = (adapter as any).readCachedChats(client);
  assert.equal(first, (adapter as any).readCachedChats(client));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first, (adapter as any).readCachedChats(client));
  assert.equal(calls, 1);
  finish([]);
  await first;
  const next = (adapter as any).readCachedChats(client);
  assert.equal(calls, 2);
  finish([]);
  await next;
});

test("logout accepts a new QR and relink on the same client without browser recovery", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  Object.assign(client.pupPage, { evaluate: async () => {} });
  Object.assign(adapter, { client, state: "ready", syncTriggered: true, readyDone: true, onMessage: async () => {} });
  (adapter as any).attachHandlers(client);
  client.emit("disconnected", "LOGOUT");
  assert.match(adapter.getStatus().detail || "", /logged out/);
  assert.equal((adapter as any).syncTriggered, false);
  assert.equal((adapter as any).readyDone, false);
  client.emit("qr", "test-only-qr");
  assert.equal(adapter.getStatus().state, "qr");
  client.emit("authenticated");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "starting");
  assert.equal(adapter.getStatus().qr, null);
  Object.assign(adapter, { installWebCompatibilityPatches: async () => {}, reconcileRecentMessages: async () => {}, backfill: async () => {} });
  client.emit("ready");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "ready");
});

test("logout invalidates an in-flight ready callback on the same browser", async () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let finish!: () => void;
  Object.assign(adapter, {
    client, state: "starting", onMessage: async () => {},
    installWebCompatibilityPatches: () => new Promise<void>(resolve => { finish = resolve; }),
  });
  (adapter as any).attachHandlers(client);
  client.emit("ready");
  client.emit("disconnected", "LOGOUT");
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "disconnected");
  client.emit("ready");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "disconnected");
});

test("a closed WhatsApp browser cannot continue reporting ready", () => {
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  client.pupBrowser.isConnected = () => false;
  Object.assign(adapter, { client, state: "ready" });
  assert.equal(adapter.getStatus().state, "disconnected");
});

test("browser loss is detected and events from retired clients cannot disconnect the replacement", async () => {
  const adapter = new WhatsAppAdapter();
  const harness = adapter as any;
  const first = browserClient();
  Object.assign(adapter, { client: first, state: "ready" });
  harness.watchBrowser(first);
  first.pupPage.emit("close", undefined);
  assert.equal(adapter.getStatus().state, "disconnected");

  const replacement = browserClient();
  Object.assign(adapter, { client: replacement, state: "ready" });
  await harness.disposeClient(first);
  first.pupBrowser.emit("disconnected");
  assert.equal(adapter.getStatus().state, "ready");
});

test("a delayed ready callback from a retired session cannot mark a replacement ready", async () => {
  const adapter = new WhatsAppAdapter();
  const harness = adapter as any;
  const first = browserClient();
  let finishPatch!: () => void;
  const patch = new Promise<void>((resolve) => { finishPatch = resolve; });
  Object.assign(adapter, {
    client: first,
    state: "starting",
    onMessage: async () => {},
    installWebCompatibilityPatches: () => patch,
  });
  harness.attachHandlers(first);
  first.emit("ready");
  Object.assign(adapter, { client: browserClient(), state: "starting" });
  finishPatch();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getStatus().state, "starting");
});

test("hung startup is bounded and its browser is disposed", async () => {
  const previousTimeout = process.env.WHATSAPP_CONNECT_TIMEOUT_MS;
  process.env.WHATSAPP_CONNECT_TIMEOUT_MS = "20";
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let destroyed = 0;
  client.destroy = async () => { destroyed++; };
  Object.assign(client, { initialize: () => new Promise<void>(() => {}) });
  Object.assign(adapter, { buildClient: () => client, cleanLocks: () => {} });
  try {
    await adapter.start(async () => {});
    assert.equal(adapter.getStatus().state, "disconnected");
    assert.equal(destroyed, 1);
  } finally {
    await adapter.stop();
    if (previousTimeout === undefined) delete process.env.WHATSAPP_CONNECT_TIMEOUT_MS;
    else process.env.WHATSAPP_CONNECT_TIMEOUT_MS = previousTimeout;
  }
});

test("automatic recovery does not tear down an in-flight WhatsApp send", async () => {
  const adapter = new WhatsAppAdapter();
  let finishSend!: (message: unknown) => void;
  const pending = new Promise((resolve) => { finishSend = resolve; });
  Object.assign(adapter, {
    ensureReady: async () => {},
    client: { sendMessage: () => pending },
  });
  const sending = adapter.send("123@c.us", "hello");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(adapter.recover(), /deferred while a message is sending/);
  finishSend({ id: { id: "message-1" } });
  assert.equal((await sending).messageExternalId, "whatsapp:123@c.us:message-1");
});

test("a stalled send retires its browser before releasing ownership and never resends", async () => {
  const previousTimeout = process.env.WHATSAPP_SEND_TIMEOUT_MS;
  process.env.WHATSAPP_SEND_TIMEOUT_MS = "20";
  const adapter = new WhatsAppAdapter();
  const client = browserClient();
  let nativeSends = 0;
  let destroyed = 0;
  client.destroy = async () => { destroyed++; };
  Object.assign(client, {
    sendMessage: () => {
      nativeSends++;
      return new Promise(() => {});
    },
  });
  Object.assign(adapter, {
    client,
    state: "ready",
    pageIsHealthy: async () => true,
  });
  try {
    const first = adapter.send("123@c.us", "first");
    const queued = adapter.send("456@c.us", "second");
    const results = await Promise.allSettled([first, queued]);
    assert.equal(results[0].status, "rejected");
    assert.match(String((results[0] as PromiseRejectedResult).reason), /timed out.*unconfirmed/);
    assert.equal(results[1].status, "rejected");
    assert.match(String((results[1] as PromiseRejectedResult).reason), /reconnecting/);
    assert.equal(nativeSends, 1);
    assert.equal(destroyed, 1);
    assert.equal((adapter as any).activeSends, 0);
    assert.equal(adapter.getStatus().state, "disconnected");
  } finally {
    if (previousTimeout === undefined) delete process.env.WHATSAPP_SEND_TIMEOUT_MS;
    else process.env.WHATSAPP_SEND_TIMEOUT_MS = previousTimeout;
  }
});
