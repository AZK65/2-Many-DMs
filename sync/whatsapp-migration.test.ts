import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalWhatsAppMessage } from "./retention";
import type { InboundMessage } from "./adapters/types";

test("Baileys ingestion reuses the existing web account's chats, flags and message rows", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "omni-wa-migration-test-"));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  let store: typeof import("./store") | undefined;
  try {
    const sqlite = spawnSync("sqlite3", [path.join(dir, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(sqlite.status, 0, sqlite.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    store = await import("./store");
    await store.prismaReady;
    const { prisma, persistInbound } = store;
    const user = await prisma.user.create({ data: { email: "fixture@example.invalid" } });
    const account = await prisma.account.create({ data: { userId: user.id, platform: "whatsapp", driver: "web" } });
    const m: InboundMessage = { accountId: account.id, platform: "whatsapp", chatExternalId: "123@c.us", messageExternalId: "whatsapp:123@c.us:ABC", timestamp: new Date(), direction: "in", body: "fixture", contact: { externalKey: "whatsapp:123@c.us", name: "Existing contact", handle: "+123" } };
    await persistInbound(m);
    const before = await prisma.conversation.findFirstOrThrow();
    await prisma.conversation.update({ where: { id: before.id }, data: { pinned: true, todo: true } });
    const original = await prisma.message.findFirstOrThrow();
    await prisma.account.update({ where: { id: account.id }, data: { driver: "baileys" } });
    await persistInbound(canonicalWhatsAppMessage({ ...m, historical: true, chatExternalId: "123@s.whatsapp.net", messageExternalId: "whatsapp:123@s.whatsapp.net:ABC", contact: { ...m.contact, externalKey: "whatsapp:123@s.whatsapp.net" }, media: { type: "image", url: "/media/fixture.jpg" } }));
    assert.equal(await prisma.conversation.count(), 1);
    assert.equal(await prisma.contact.count(), 1);
    assert.equal(await prisma.message.count(), 1);
    const after = await prisma.conversation.findFirstOrThrow();
    assert.equal(after.id, before.id);
    assert.equal(after.unread, before.unread);
    assert.equal(after.pinned, true);
    assert.equal(after.todo, true);
    assert.equal((await prisma.message.findFirstOrThrow()).id, original.id);
    assert.equal((await prisma.message.findFirstOrThrow()).mediaUrl, "/media/fixture.jpg");
  } finally {
    await store?.prisma.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
