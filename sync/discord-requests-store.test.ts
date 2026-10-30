import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { DiscordSearchAdapter } from "./adapters/discord-search";

test("request category reconciliation is account-scoped and preserves manual choices and message data", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "omni-discord-requests-"));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  const db = new PrismaClient();
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    const user = await db.user.create({ data: { email: "discord-fixture@example.invalid" } });
    const account = await db.account.create({ data: { userId: user.id, platform: "discord" } });
    const other = await db.account.create({ data: { userId: user.id, platform: "discord" } });
    const contact = await db.contact.create({ data: { name: "Fixture Contact", handle: "fixture" } });
    const common = { contactId: contact.id, platform: "discord", inboxCategory: "general", unread: 7, todoNote: "Manual note" };
    const automatic = await db.conversation.create({ data: { ...common, accountId: account.id, externalId: "123" } });
    const manual = await db.conversation.create({ data: { ...common, accountId: account.id, externalId: "124", inboxOverride: true } });
    const unrelated = await db.conversation.create({ data: { ...common, accountId: other.id, externalId: "123" } });
    const adapter = new DiscordSearchAdapter({ token: "fixture", userId: "999", username: "fixture" }, account.id) as any;
    await adapter.reconcileInboxCategories([
      { id: "123", type: 1, is_message_request: true, is_spam: false },
      { id: "124", type: 1, is_message_request: true, is_spam: false },
    ]);
    assert.deepEqual(await db.conversation.findUnique({ where: { id: automatic.id } }), { ...automatic, inboxCategory: "spam" });
    assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: manual.id } })).inboxCategory, "general");
    assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: unrelated.id } })).inboxCategory, "general");
    await adapter.reconcileInboxCategories([{ id: "123", type: 1 }]);
    assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: automatic.id } })).inboxCategory, "spam");
    await adapter.reconcileInboxCategories([{ id: "123", type: 1, is_message_request: false, is_spam: false }]);
    assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: automatic.id } })).inboxCategory, "general");
    await adapter.stop();
  } finally {
    await db.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
