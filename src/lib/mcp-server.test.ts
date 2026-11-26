import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createChatMcpServer } from "./mcp-server";
import { createAgentMcpEndpoint } from "./mcp-http";
import { agentAccessStore } from "./mcp-access";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-fixture-"));
const url = `file:${path.join(root, "fixture.db")}`;
const db = new PrismaClient({ datasources: { db: { url } } });
let rpcId = 0;
async function rpc(method: string, params: unknown) {
  const handler = createMcpHandler(
    () => createChatMcpServer(db, { accountIds: ["allowed"] }),
    { maxRequestBodySize: 16_384, maxSubscriptions: 0 },
  );
  try {
    const response = await handler.fetch(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      }),
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    const parsed = JSON.parse(
      text.startsWith("event:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data:"))!
            .slice(5)
        : text,
    );
    return parsed;
  } finally {
    await handler.close();
  }
}
const call = async (name: string, args = {}) =>
  (await rpc("tools/call", { name, arguments: args })).result;

before(async () => {
  fs.writeFileSync(path.join(root, "fixture.db"), "");
  execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "db",
      "push",
      "--skip-generate",
      "--schema",
      "prisma/schema.prisma",
    ],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  await db.user.create({
    data: { id: "user", email: "fixture@example.invalid" },
  });
  for (const account of ["allowed", "denied"]) {
    await db.account.create({
      data: {
        id: account,
        userId: "user",
        platform: "x",
        label: account,
        session: "SECRET_SESSION",
      },
    });
    await db.contact.create({
      data: {
        id: account,
        name: `${account} person`,
        handle: `@${account}`,
        notes: "PRIVATE_NOTE",
      },
    });
    await db.conversation.create({
      data: {
        id: account,
        contactId: account,
        accountId: account,
        platform: "x",
        unread: 7,
      },
    });
  }
  await db.message.createMany({
    data: [
      {
        id: "a",
        conversationId: "allowed",
        body: "budget approved",
        direction: "in",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        id: "b",
        conversationId: "allowed",
        body: "photo",
        ocrText: "budget invoice",
        direction: "in",
        mediaType: "image",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        id: "c",
        conversationId: "allowed",
        body: "budget preview",
        direction: "in",
        externalKey: "x:preview:test",
        createdAt: new Date("2026-01-01T11:00:00Z"),
      },
      {
        id: "deleted",
        conversationId: "allowed",
        body: "budget deleted",
        direction: "in",
        deletedAt: new Date(),
      },
      {
        id: "secret",
        conversationId: "denied",
        body: "budget SECRET_CHAT",
        direction: "in",
      },
    ],
  });
});
after(async () => {
  await db.$disconnect();
  fs.rmSync(root, { recursive: true, force: true });
});

test("MCP initializes and exposes only four read-only tools", async () => {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "2manydms");
  const list = await rpc("tools/list", {});
  assert.deepEqual(
    list.result.tools.map((tool: { name: string }) => tool.name).sort(),
    ["connection_status", "read_chat", "search_chats", "search_messages"],
  );
  assert.ok(
    list.result.tools.every(
      (tool: { annotations: { readOnlyHint: boolean } }) =>
        tool.annotations.readOnlyHint,
    ),
  );
  assert.ok(
    (await rpc("tools/call", { name: "send_message", arguments: {} })).error,
  );
});
test("account scope applies to discovery, counts, message search and direct IDs", async () => {
  const status = (await call("connection_status")).structuredContent;
  assert.equal(status.savedChats, 1);
  assert.equal(status.savedMessages, 3);
  const chats = (await call("search_chats")).structuredContent;
  assert.equal(chats.chats.length, 1);
  assert.equal(chats.chats[0].id, "allowed");
  assert.ok((await call("read_chat", { conversationId: "denied" })).isError);
  const results = await call("search_messages", { query: "budget" });
  assert.equal(results.structuredContent.messages.length, 3);
  assert.ok(!JSON.stringify([status, chats, results]).includes("SECRET"));
  assert.ok(!JSON.stringify(chats).includes("PRIVATE_NOTE"));
  assert.equal(
    (
      await call("search_messages", {
        query: "budget",
        conversationId: "denied",
      })
    ).structuredContent.messages.length,
    0,
  );
});
test("history pages are stable with tied timestamps, previews are explicit, reads do not mark read", async () => {
  const first = (
    await call("read_chat", { conversationId: "allowed", limit: 2 })
  ).structuredContent;
  assert.deepEqual(
    first.messages.map((message: { id: string }) => message.id),
    ["b", "c"],
  );
  assert.equal(first.messages[1].isInboxPreview, true);
  assert.equal(first.nextBeforeMessageId, "b");
  const older = (
    await call("read_chat", {
      conversationId: "allowed",
      beforeMessageId: "b",
      limit: 2,
    })
  ).structuredContent;
  assert.deepEqual(
    older.messages.map((message: { id: string }) => message.id),
    ["a"],
  );
  assert.equal(older.nextBeforeMessageId, null);
  assert.ok(
    (
      await call("read_chat", {
        conversationId: "allowed",
        beforeMessageId: "secret",
      })
    ).isError,
  );
  assert.equal(
    (await db.conversation.findUniqueOrThrow({ where: { id: "allowed" } }))
      .unread,
    7,
  );
});
test("search covers OCR, date/platform filters, pagination and malformed inputs", async () => {
  assert.equal(
    (await call("search_messages", { query: "invoice" })).structuredContent
      .messages[0].id,
    "b",
  );
  const first = (await call("search_messages", { query: "budget", limit: 2 }))
    .structuredContent;
  assert.deepEqual(
    first.messages.map((m: { id: string }) => m.id),
    ["c", "b"],
  );
  assert.equal(
    (await call("search_messages", { query: "budget", beforeMessageId: "b" }))
      .structuredContent.messages[0].id,
    "a",
  );
  assert.equal(
    (
      await call("search_messages", {
        query: "budget",
        since: "2026-01-01T10:30:00Z",
      })
    ).structuredContent.messages.length,
    1,
  );
  assert.equal(
    (await call("search_messages", { query: "budget", platform: "whatsapp" }))
      .structuredContent.messages.length,
    0,
  );
  assert.ok(
    (await call("read_chat", { conversationId: "allowed", limit: 9999 }))
      .isError,
  );
  assert.ok((await call("search_messages", { query: "x" })).isError);
});

test("HTTP boundary requires keys on every request, rejects unsafe origins and oversized bodies, and revokes immediately", async () => {
  const store = agentAccessStore(root);
  const endpoint = createAgentMcpEndpoint(db, store);
  const { key, token } = store.create("HTTP fixture", ["allowed"]);
  const request = (authorization: string, origin?: string, body?: string) =>
    new Request("http://127.0.0.1:3000/api/mcp", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(origin ? { origin } : {}),
      },
      body:
        body ||
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
    });
  assert.equal((await endpoint(request(""))).status, 401);
  assert.equal(
    (await endpoint(request(`Bearer ${token}`, "https://evil.example"))).status,
    403,
  );
  const good = await endpoint(request(`Bearer ${token}`));
  assert.equal(good.status, 200);
  assert.match(await good.text(), /search_messages/);
  assert.equal(good.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (await endpoint(request(`Bearer ${token}`, undefined, " ".repeat(20_000))))
      .status,
    413,
  );
  store.revoke(key.id);
  assert.equal((await endpoint(request(`Bearer ${token}`))).status, 401);
});
