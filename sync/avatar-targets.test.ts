import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { avatarTarget, avatarContactWhere, collectAvatarJobs } from "./avatar-targets";

test("avatar targets use exact platform IDs, including opaque WhatsApp LIDs and X members", () => {
  assert.equal(avatarTarget("whatsapp", "whatsapp:987@lid"), "987@lid");
  assert.equal(avatarTarget("x", "x:user:123"), "user:123");
  assert.equal(avatarTarget("x", "x:g123"), "g123");
  assert.equal(avatarTarget("telegram", "telegram:123__t4"), "123__t4");
  assert.equal(avatarTarget("whatsapp", "telegram:123"), null);
  assert.equal(avatarTarget("telegram", "telegram:John"), null);
});

test("backfill covers group-only senders, deduplicates contacts, and validates account access", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "omni-avatar-targets-"));
  const url = `file:${path.join(directory, "test.db")}`;
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: url }, encoding: "utf8",
    });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    const user = await db.user.create({ data: { email: "avatars@example.test" } });
    const [a, b] = await Promise.all(["a", "b"].map(label => db.account.create({ data: { userId: user.id, platform: "telegram", label } })));
    const [group, direct, member, outside] = await Promise.all([
      { externalKey: "telegram:100", name: "Group", isGroup: true },
      { externalKey: "telegram:200", name: "Direct", avatarUrl: "/avatars/old.jpg" },
      { externalKey: "telegram:300", name: "Member" },
      { externalKey: "telegram:400", name: "Different account" },
    ].map(data => db.contact.create({ data: { ...data, handle: data.name } })));
    const chat = await db.conversation.create({ data: { accountId: a.id, platform: "telegram", externalId: "100", contactId: group.id } });
    const other = await db.conversation.create({ data: { accountId: b.id, platform: "telegram", externalId: "100", contactId: group.id } });
    await db.conversation.create({ data: { accountId: a.id, platform: "telegram", externalId: "200", contactId: direct.id } });
    await db.message.createMany({ data: [
      { conversationId: chat.id, senderContactId: member.id, externalKey: "telegram:100:1", direction: "in", body: "one", createdAt: new Date(1_000) },
      { conversationId: chat.id, senderContactId: member.id, externalKey: "telegram:100:2", direction: "in", body: "two", createdAt: new Date(2_000) },
      { conversationId: chat.id, senderContactId: direct.id, direction: "in", body: "also in group" },
      { conversationId: other.id, senderContactId: outside.id, direction: "in", body: "private to other account" },
    ] });
    const jobs = await collectAvatarJobs(db, [a.id]);
    assert.equal(jobs.length, 3);
    assert.equal(jobs.filter(job => job.contactId === direct.id).length, 1);
    assert.equal(jobs.at(-1)?.contactId, direct.id, "missing photos are first");
    const sender = jobs.find(job => job.contactId === member.id)!;
    assert.equal(sender.chatId, "300");
    assert.equal(sender.groupExternalId, "100");
    assert.equal(sender.senderMessageExternalId, "telegram:100:2");
    assert.equal(await db.contact.count({ where: avatarContactWhere(sender) }), 1);
    assert.equal(await db.contact.count({ where: avatarContactWhere({ ...sender, accountId: b.id }) }), 0);
    assert.equal(await db.contact.count({ where: avatarContactWhere({ ...sender, chatId: "400" }) }), 0);
    assert.equal(await db.contact.count({ where: avatarContactWhere({ ...sender, externalKey: "telegram:400" }) }), 0);
    assert.deepEqual(await collectAvatarJobs(db, []), []);
    assert.equal(await db.message.count(), 4, "photo collection never alters messages");
  } finally { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
});
