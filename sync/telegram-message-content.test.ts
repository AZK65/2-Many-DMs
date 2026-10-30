import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TelegramAdapter } from "./adapters/telegram";
import { telegramSpecialBody, telegramPlaceholderRepair } from "./telegram-message-content";

test("native group creation and member additions have readable event summaries", () => {
  const created = new Api.MessageService({ id: 1, peerId: new Api.PeerChat({ chatId: bigInt(42) }), date: 1700000000, out: true, action: new Api.MessageActionChatCreate({ title: "Studio", users: [bigInt(7)] }) });
  assert.equal(telegramSpecialBody(created), "You created the group “Studio”.");
  const added = { fromId: { userId: 7 }, action: { className: "MessageActionChatAddUser", users: [8] } };
  assert.equal(telegramSpecialBody(added, "Francesco"), "Francesco added 1 member to the group.");
  assert.equal(telegramSpecialBody(added, "Francesco", new Map([["8", "Nico"]])), "Francesco added Nico to the group.");
  assert.equal(telegramSpecialBody({ ...added, fromId: { userId: 8 } }, "Nico"), "Nico joined the group.");
  assert.equal(telegramSpecialBody({ fromId: { userId: 8 }, action: { className: "MessageActionChatDeleteUser", userId: 8 } }, "Nico"), "Nico left the group.");
});

test("calls, title changes, unknown actions and unsupported media remain honest", () => {
  assert.equal(telegramSpecialBody({ action: { className: "MessageActionPhoneCall", duration: 65 }, out: true }), "Outgoing voice call · 1:05.");
  assert.equal(telegramSpecialBody({ action: { className: "MessageActionPhoneCall", video: true, reason: { className: "PhoneCallDiscardReasonMissed" } } }), "Missed video call.");
  assert.equal(telegramSpecialBody({ action: { className: "MessageActionChatEditTitle", title: "Projects" } }, "Nico"), "Nico renamed the group to “Projects”.");
  assert.match(telegramSpecialBody({ action: { className: "FutureAction" } }), /Open Telegram/);
  assert.match(telegramSpecialBody({ media: { className: "MessageMediaPhoto", ttlSeconds: 60 } }), /Disappearing media/);
});

test("contacts, rich text polls, dice and valid locations retain their content", () => {
  assert.equal(telegramSpecialBody({ media: { className: "MessageMediaContact", firstName: "Nico", phoneNumber: "+15550000000" } }), "Shared contact\nNico\n+15550000000");
  assert.match(telegramSpecialBody({ media: { className: "MessageMediaPoll", poll: { question: { text: "When?" }, answers: [{ text: "Today" }, { text: { text: "Tomorrow" } }] } } }), /When\?\n• Today\n• Tomorrow/);
  assert.equal(telegramSpecialBody({ media: { className: "MessageMediaDice", emoticon: "🎲", value: 4 } }), "🎲 · 4");
  assert.match(telegramSpecialBody({ media: { className: "MessageMediaGeo", geo: { lat: 0, long: 0 } } }), /q=0,0/);
  assert.doesNotMatch(telegramSpecialBody({ media: { className: "MessageMediaGeo", geo: { lat: NaN, long: 999 } } }), /https:/);
});

test("adapter keeps actual text and attachments intact and formats real service messages", async () => {
  const adapter = new TelegramAdapter(12345, "a".repeat(32), "") as any;
  const chat = { id: 42, title: "Studio" };
  const base = { id: 1, out: true, date: 1700000000 };
  const opts = { downloadAvatar: false, downloadMedia: false };
  const service = await adapter.buildMessage(chat, { ...base, action: { className: "MessageActionChatCreate", title: "Studio" } }, opts);
  assert.equal(service.body, "You created the group “Studio”.");
  assert.equal(service.messageExternalId, "telegram:42:1");
  assert.equal((await adapter.buildMessage(chat, { ...base, message: "Actual text" }, opts)).body, "Actual text");
  const photo = await adapter.buildMessage(chat, { ...base, photo: {}, message: "Caption" }, opts);
  assert.equal(photo.body, "Caption"); assert.equal(photo.media.type, "image");
});

test("repair is restricted to exact Telegram placeholders", () => {
  assert.equal(telegramPlaceholderRepair("telegram", "[unsupported message]", "Group created."), true);
  for (const [platform, old, next] of [["whatsapp", "[unsupported message]", "new"], ["telegram", "Real content", "new"], ["telegram", "[unsupported message]", ""], ["telegram", "[unsupported message]", "[unsupported message]"]]) assert.equal(telegramPlaceholderRepair(platform, old, next), false);
});

test("backfill repairs saved placeholders without duplicates, unread changes or losing timestamps", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "omni-tg-placeholder-test-"));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  let store: typeof import("./store") | undefined;
  try {
    assert.equal(spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"]).status, 0);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr);
    store = await import("./store"); await store.prismaReady;
    const user = await store.prisma.user.create({ data: { email: "fixture@example.invalid" } });
    const account = await store.prisma.account.create({ data: { userId: user.id, platform: "telegram" } });
    const message: import("./adapters/types").InboundMessage = { accountId: account.id, platform: "telegram", chatExternalId: "42", messageExternalId: "telegram:42:1", direction: "in", body: "[unsupported message]", timestamp: new Date("2026-10-30T15:05:15Z"), isGroup: true, contact: { externalKey: "telegram:42", name: "Studio", handle: "Group" } };
    await store.persistInbound(message);
    const before = await store.prisma.message.findFirstOrThrow();
    const unread = (await store.prisma.conversation.findFirstOrThrow()).unread;
    await store.prisma.message.update({ where: { id: before.id }, data: { translatedBody: "Old placeholder translation" } });
    await store.persistInbound({ ...message, body: "Nico joined the group.", historical: true });
    await store.persistInbound({ ...message, historical: true });
    const after = await store.prisma.message.findFirstOrThrow();
    assert.equal(await store.prisma.message.count(), 1);
    assert.equal(after.id, before.id); assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
    assert.equal(after.body, "Nico joined the group."); assert.equal(after.translatedBody, null);
    assert.equal((await store.prisma.conversation.findFirstOrThrow()).unread, unread);
  } finally {
    await store?.prisma.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});
