import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MessageMutations, type MutationInput } from "./message-mutations";
import type { Adapter, InboundMessage } from "./adapters/types";
import { MessageMutationRejected } from "../src/lib/message-mutations";

test("native mutations are account-scoped, idempotent, conflict-safe and survive history replay", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "message-actions-test-"));
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  let store: typeof import("./store") | undefined;
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    store = await import("./store");
    await store.prismaReady;
    const { prisma, persistInbound } = store;
    const user = await prisma.user.create({ data: { email: "actions@example.invalid" } });
    const account = await prisma.account.create({ data: { platform: "telegram", userId: user.id } });
    const inbound: InboundMessage = { platform: "telegram", accountId: account.id, chatExternalId: "123",
      messageExternalId: "telegram:123:456", direction: "out", body: "Original fixture", timestamp: new Date(),
      contact: { externalKey: "telegram:123", name: "Fixture Person", handle: "fixture" } };
    await persistInbound(inbound);
    const original = await prisma.message.findUniqueOrThrow({ where: { externalKey: inbound.messageExternalId } });
    let calls = 0;
    let fail = false;
    const adapter = { platform: "telegram", getStatus: () => ({ state: "ready", platform: "telegram" }),
      editMessage: async (chat: string, key: string, body: string) => {
        assert.equal(chat, "123"); assert.equal(key, inbound.messageExternalId); assert.ok(body);
        calls++; if (fail) throw new Error("Synthetic connection lost");
        await new Promise(resolve => setTimeout(resolve, 15));
      }, deleteMessage: async () => { calls++; },
    } as unknown as Adapter;
    const service = new MessageMutations(prisma, id => id === account.id ? adapter : undefined, (_adapter, task) => task());
    const input: MutationInput = { conversationId: original.conversationId, messageId: original.id, userId: user.id,
      action: "edit", expectedBody: original.body, expectedEditedAt: null, body: "Edited fixture https://example.com/Go", requestId: "request-1" };
    await assert.rejects(service.execute({ ...input, userId: "someone-else" }), /workspace/);
    await assert.rejects(service.execute({ ...input, conversationId: "another-chat" }), /workspace/);
    await assert.rejects(service.execute({ ...input, expectedBody: "stale" }), /changed/);
    assert.equal(calls, 0);
    await Promise.all([service.execute(input), service.execute(input)]);
    assert.equal(calls, 1, "double click is one native call");
    await service.execute(input);
    assert.equal(calls, 1, "completed request retry does not repeat the native operation");
    const edited = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(edited.body, input.body); assert.ok(edited.editedAt);
    assert.equal(edited.createdAt.getTime(), original.createdAt.getTime(), "editing is not a new message");
    await persistInbound({ ...inbound, historical: true });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: original.id } })).body, input.body);
    const second = { ...input, requestId: "request-2", expectedBody: edited.body, expectedEditedAt: edited.editedAt!.toISOString() };
    await service.execute({ ...second, action: "delete" });
    const deleted = await prisma.message.findUniqueOrThrow({ where: { id: original.id } });
    assert.ok(deleted.deletedAt); assert.equal(deleted.body, "Message deleted");
    await persistInbound({ ...inbound, historical: true });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: original.id } })).body, "Message deleted");
    assert.equal(await prisma.message.count(), 1, "tombstone prevents resurrection");
    await assert.rejects(service.execute({ ...second, requestId: "request-3" }), /cannot be changed/);

    await persistInbound({ ...inbound, messageExternalId: "telegram:123:457" });
    const another = await prisma.message.findUniqueOrThrow({ where: { externalKey: "telegram:123:457" } });
    const pending = { ...input, messageId: another.id, requestId: "request-4" };
    fail = true;
    adapter.editMessage = async () => { calls++; throw new Error("Synthetic connection lost"); };
    await assert.rejects(service.execute(pending), /not be retried automatically/);
    const uncertain = await prisma.message.findUniqueOrThrow({ where: { id: another.id } });
    assert.equal(uncertain.body, another.body); assert.equal(uncertain.mutationState, "uncertain");
    const failedCalls = calls;
    const restarted = new MessageMutations(prisma, () => adapter, (_adapter, task) => task());
    await assert.rejects(restarted.execute(pending), /unconfirmed/);
    assert.equal(calls, failedCalls, "worker restart never replays uncertain actions");

    const xAccount = await prisma.account.create({ data: { platform: "x", driver: "browser", userId: user.id } });
    const xInbound: InboundMessage = { ...inbound, platform: "x", accountId: xAccount.id, chatExternalId: "111-222",
      messageExternalId: "x:00000000-0000-4000-8000-000000000001", contact: { externalKey: "x:fixture-person", name: "Fixture Person", handle: "fixture-person" } };
    await persistInbound(xInbound);
    const xMessage = await prisma.message.findUniqueOrThrow({ where: { externalKey: xInbound.messageExternalId } });
    let rejectsSafely = true, xCalls = 0;
    const xAdapter = { platform: "x", getStatus: () => ({ state: "ready", platform: "x" }),
      editMessage: async (chat: string, key: string, _body: string, context?: { expectedBody: string }) => {
        assert.equal(chat, "111-222"); assert.equal(key, xInbound.messageExternalId);
        assert.equal(context?.expectedBody, xMessage.body);
        if (rejectsSafely) throw new MessageMutationRejected("X does not offer Edit message");
        xCalls++;
      }, deleteMessage: async () => { xCalls++; },
    } as unknown as Adapter;
    const xService = new MessageMutations(prisma, id => id === xAccount.id ? xAdapter : undefined, (_adapter, task) => task());
    const xInput = { ...input, conversationId: xMessage.conversationId, messageId: xMessage.id, requestId: "x-action-1" };
    await assert.rejects(xService.execute(xInput), /does not offer/);
    const rejected = await prisma.message.findUniqueOrThrow({ where: { id: xMessage.id } });
    assert.equal(rejected.mutationState, null); assert.equal(rejected.mutationRequestId, null);
    rejectsSafely = false;
    await xService.execute(xInput);
    assert.equal(xCalls, 1);
    await persistInbound({ ...xInbound, messageExternalId: "x:preview:old-outgoing", timestamp: new Date(Date.now() + 1000) });
    assert.equal(await prisma.message.count({ where: { conversationId: xMessage.conversationId } }), 1, "stale preview cannot recreate edited content");
    await persistInbound({ ...xInbound, messageExternalId: "x:00000000-0000-4000-8000-000000000002", timestamp: new Date(Date.now() + 2000) });
    assert.equal(await prisma.message.count({ where: { conversationId: xMessage.conversationId } }), 2, "real repeated messages with new IDs remain intact");
    const xEdited = await prisma.message.findUniqueOrThrow({ where: { id: xMessage.id } });
    await xService.execute({ ...xInput, requestId: "x-action-2", action: "delete", expectedBody: xEdited.body, expectedEditedAt: xEdited.editedAt!.toISOString() });
    await persistInbound(xInbound);
    await persistInbound({ ...xInbound, messageExternalId: "x:preview:deleted-outgoing" });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: xMessage.id } })).body, "Message deleted");
    assert.equal(await prisma.message.count({ where: { conversationId: xMessage.conversationId } }), 2, "deleted messages do not reappear as native or preview copies");
  } finally {
    await store?.prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
