import assert from "node:assert/strict";
import { test } from "node:test";
import { reuseTelegramPrimarySender } from "./telegram-media-sender";

test("media reuses primary Telegram transport without changing cross-DC routing", async () => {
  const calls: number[] = [];
  const primary = {}, exported = {};
  const client = { session: { dcId: 4 }, async getSender(id: number) {
    calls.push(id); return id === 0 ? primary : exported;
  } };
  reuseTelegramPrimarySender(client);
  assert.equal(await client.getSender(0), primary);
  assert.equal(await client.getSender(4), primary);
  assert.equal(await client.getSender(2), exported);
  client.session.dcId = 2; // Follow a real main-DC migration too.
  assert.equal(await client.getSender(2), primary);
  assert.equal(await client.getSender(4), exported);
  assert.deepEqual(calls, [0, 0, 2, 0, 4]);
});
