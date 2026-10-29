import test from "node:test";
import assert from "node:assert/strict";
import { Api } from "telegram";
import bigInt from "big-integer";
import { BinaryReader } from "telegram/extensions/BinaryReader";
import { TelegramAdapter } from "./adapters/telegram";
const { resolveProfileEntity } = require("./telegram-media-download-worker.cjs");

test("a group-only sender resolves through their exact known message without scanning history", async () => {
  const adapter = new TelegramAdapter(1, "test", "") as any;
  adapter.client.session.getInputEntity = (peer: any) => {
    if (peer === "-100500") {
      return new Api.InputPeerChannel({ channelId: bigInt(500), accessHash: bigInt(99) });
    }
    throw Error("not cached");
  };
  adapter.client.getEntity = () => assert.fail("network work must be isolated");
  adapter.avatarDownloader = { download: async (input: any) => {
    const peer = new BinaryReader(Buffer.from(input.media)).tgReadObject();
    assert.ok(peer instanceof Api.InputPeerUserFromMessage);
    assert.equal(String(peer.userId), "123");
    assert.equal(peer.msgId, 42);
    assert.ok(peer.peer instanceof Api.InputPeerChannel);
    assert.equal(String(peer.peer.channelId), "500");
    await resolveProfileEntity({ invoke: async (request: any) => {
      assert.ok(request instanceof Api.users.GetUsers);
      assert.ok(request.id[0] instanceof Api.InputUserFromMessage);
      assert.equal(String(request.id[0].userId), "123");
      return [new Api.User({ id: bigInt(123) })];
    }, getEntity: () => assert.fail("GramJS cannot resolve this peer directly") }, peer);
    assert.deepEqual(input.profile, { id: "123", isGroup: false });
    return Buffer.alloc(0);
  } };
  assert.deepEqual(await adapter.refreshAvatar("123", false, {
    groupExternalId: "500__t9", senderMessageExternalId: "telegram:500:42",
  }), { source: "unavailable" });
});

test("stored GramJS peers are retrieved from the actual session cache by marked ID", async () => {
  const adapter = new TelegramAdapter(1, "test", "") as any;
  const user = new Api.User({ id: bigInt(123), accessHash: bigInt(456), firstName: "Known" });
  adapter.client.session.processEntities([user]);
  adapter.avatarDownloader = { download: async (input: any) => {
    const peer = new BinaryReader(Buffer.from(input.media)).tgReadObject();
    assert.ok(peer instanceof Api.InputPeerUser);
    assert.equal(String(peer.accessHash), "456", "do not fall back to a zero hash when a cached identity exists");
    return Buffer.alloc(0);
  } };
  assert.deepEqual(await adapter.refreshAvatar("123", false), { source: "unavailable" });
});

test("mismatched sender evidence is not used to retrieve someone else's photo", async () => {
  const adapter = new TelegramAdapter(1, "test", "") as any;
  adapter.client.session.getInputEntity = () => { throw Error("not cached"); };
  adapter.avatarDownloader = { download: async (input: any) => {
    const peer = new BinaryReader(Buffer.from(input.media)).tgReadObject();
    assert.ok(peer instanceof Api.InputPeerUser);
    assert.equal(String(peer.userId), "123");
    return Buffer.alloc(0);
  } };
  assert.deepEqual(await adapter.refreshAvatar("123", false, {
    groupExternalId: "500", senderMessageExternalId: "telegram:999:42",
  }), { source: "unavailable" });
});
