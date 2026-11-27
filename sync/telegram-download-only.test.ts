import assert from "node:assert/strict";
import test from "node:test";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { createRequire } from "node:module";
import bigInt from "big-integer";

const { configureDownloadOnlyClient } = createRequire(import.meta.url)("./telegram-download-only.cjs");

test("download helper config, entity and raw API requests never subscribe for live updates", async () => {
  const client = new TelegramClient(new StringSession(""), 1, "test", {}) as any;
  const calls: any[] = [];
  client.invoke = async (...args: any[]) => { calls.push(args); return "result"; };
  client.invokeWithSender = async (...args: any[]) => { calls.push(args); return "sender result"; };
  let loops = 0;
  client._updateLoop.start = () => { loops++; };
  configureDownloadOnlyClient(client);

  const config = new Api.help.GetConfig();
  const initial = client._buildInitConnection(config);
  assert.ok(initial instanceof Api.InitConnection);
  assert.ok(initial.query instanceof Api.InvokeWithoutUpdates);
  assert.equal(initial.query.query, config, "connect's direct sender request must be isolated too");
  assert.ok(initial.getBytes().length > 0, "wrapped native request serializes");

  const query = new Api.users.GetUsers({ id: [new Api.InputUserSelf()] });
  const options = { timeout: 1000 };
  assert.equal(await client.invoke(query, 2, options), "result");
  assert.equal(calls[0][0].query, query);
  assert.deepEqual(calls[0].slice(1), [2, options]);
  await client.api.updates.getState();
  assert.ok(calls[1][0] instanceof Api.InvokeWithoutUpdates);
  assert.ok(calls[1][0].query instanceof Api.updates.GetState);
  const sender = {};
  assert.equal(await client.invokeWithSender(query, sender), "sender result");
  assert.equal(calls[2][0].query, query);
  assert.equal(calls[2][1], sender);
  client._updateLoop.start(true);
  assert.equal(loops, 0);
});

test("file queries retain their native download behavior and wrappers are not nested", async () => {
  const client = new TelegramClient(new StringSession(""), 1, "test", {}) as any;
  const calls: any[] = [];
  client.invoke = async (query: any) => { calls.push(query); };
  configureDownloadOnlyClient(client);
  const file = new Api.upload.GetFile({ location: new Api.InputFileLocation({ volumeId: bigInt(1), localId: 2, secret: bigInt(3), fileReference: Buffer.alloc(0) }), offset: bigInt(0), limit: 4096 });
  await client.invoke(file);
  assert.equal(calls[0], file);
  const wrapped = new Api.InvokeWithoutUpdates({ query: new Api.help.GetConfig() });
  await client.invoke(wrapped);
  assert.equal(calls[1], wrapped);
  assert.equal(client._buildInitConnection(wrapped).query, wrapped);
});

test("an incompatible client fails before a helper can open a competing connection", () => {
  assert.throws(() => configureDownloadOnlyClient({ invoke() {} }), /isolation is unavailable/);
});
