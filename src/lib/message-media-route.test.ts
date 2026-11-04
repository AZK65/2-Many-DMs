import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

test("media polling returns old completed photos without crossing conversations or changing read state", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "message-media-test-"));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  let db: typeof import("./db") | undefined;
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    db = await import("./db");
    await db.prismaReady;
    const { prisma } = db;
    const { GET } = await import("../app/api/conversations/[id]/messages/route");
    const contact = await prisma.contact.create({ data: { name: "Example contact", handle: "example" } });
    const chat = await prisma.conversation.create({ data: { platform: "x", contactId: contact.id, unread: 4 } });
    const other = await prisma.conversation.create({ data: { platform: "x", contactId: contact.id } });
    const photo = await prisma.message.create({ data: { conversationId: chat.id, body: "Photo caption", direction: "in", externalKey: "x:100000000000000001", mediaType: "image", createdAt: new Date("2026-01-01") } });
    const foreign = await prisma.message.create({ data: { conversationId: other.id, body: "", direction: "in", mediaType: "image", mediaUrl: "/media/other.jpg" } });
    for (let i = 0; i < 45; i++) await prisma.message.create({ data: { conversationId: chat.id, body: `Later text ${i}`, direction: "in", createdAt: new Date(Date.parse("2026-01-02") + i * 1000) } });
    const poll = () => GET(new NextRequest(`http://localhost/api/conversations/${chat.id}/messages?limit=40&mediaIds=${photo.id},${foreign.id}`), { params: { id: chat.id } }).then(response => response.json());
    const before = await poll();
    assert.equal(before.messages.length, 40);
    assert.ok(!before.messages.some((message: { id: string }) => message.id === photo.id));
    assert.deepEqual(before.mediaUpdates, []);
    await prisma.message.update({ where: { id: photo.id }, data: { mediaUrl: "/media/example.jpg", mediaName: "Photo.jpg" } });
    const after = await poll();
    assert.deepEqual(after.mediaUpdates.map((message: { id: string }) => message.id), [photo.id]);
    assert.equal(after.mediaUpdates[0].mediaUrl, "/media/example.jpg");
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } })).unread, 4);
    await prisma.message.update({ where: { id: photo.id }, data: { deletedAt: new Date() } });
    assert.deepEqual((await poll()).mediaUpdates, []);
  } finally {
    await db?.prisma.$disconnect();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
