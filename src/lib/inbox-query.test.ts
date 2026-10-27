import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// Exercise the actual route query against an isolated in-memory SQLite DB.
// Never load the application's configured database or sync worker in this test.
test("pending, failed and unconfirmed sends keep the incoming reply obligation", () => {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE Conversation (id TEXT);
      CREATE TABLE Message (id TEXT, conversationId TEXT, body TEXT, mediaType TEXT, direction TEXT, deliveryStatus TEXT, externalKey TEXT, createdAt INTEGER);
      INSERT INTO Conversation VALUES ('chat');
      INSERT INTO Message VALUES ('in', 'chat', 'Please help', NULL, 'in', NULL, 'x:1', 1);
      INSERT INTO Message VALUES ('out', 'chat', 'On it', NULL, 'out', 'pending', NULL, 2);`);
    const source = fs.readFileSync(new URL("../app/api/conversations/route.ts", import.meta.url), "utf8");
    const query = source.match(/prisma\.\$queryRaw<LatestMessageRow\[\]>`([\s\S]*?)`/)?.[1];
    assert.ok(query, "test must use the route's actual query");
    for (const status of ["pending", "sending", "failed", "unconfirmed"]) {
      db.prepare("UPDATE Message SET deliveryStatus = ? WHERE id = 'out'").run(status);
      const row: { replyDirection: string; deliveryStatus: string; body: string } = db.prepare(query).get();
      assert.equal(row.replyDirection, "in", status);
      assert.equal(row.deliveryStatus, status);
      assert.equal(row.body, "On it", "the attempt remains visible with its delivery state");
    }
    db.exec("UPDATE Message SET deliveryStatus = 'sent' WHERE id = 'out'");
    assert.equal(db.prepare(query).get().replyDirection, "out");
    db.exec("INSERT INTO Message VALUES ('new', 'chat', 'Another question', NULL, 'in', NULL, 'x:3', 3)");
    assert.equal(db.prepare(query).get().replyDirection, "in");
  } finally { db.close(); }
});
