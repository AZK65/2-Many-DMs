import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { GroupMembership } from "./group-membership";
import { DurableRecords } from "./retention";
import type { Adapter } from "./adapters/types";
import { groupContactScope, groupMemberPolicy, normalizeMemberTarget } from "../src/lib/group-membership";

test("manual identifiers are exact and platform-specific", () => {
  assert.equal(normalizeMemberTarget("whatsapp", "+1 (555) 123-4567"), "+15551234567");
  assert.throws(() => normalizeMemberTarget("whatsapp", "5551234567"), /country code/);
  assert.equal(normalizeMemberTarget("telegram", "https://t.me/FixtureUser"), "@fixtureuser");
  for (const value of ["two people", "https://t.me/+invite", "someone/123"]) assert.throws(() => normalizeMemberTarget("telegram", value));
  assert.equal(normalizeMemberTarget("x", "@fixture"), "@fixture");
  assert.equal(normalizeMemberTarget("discord", "123456789012345678"), "123456789012345678");
  assert.equal(normalizeMemberTarget("gmail", "person@example.invalid"), "person@example.invalid");
  for (const platform of ["x", "discord", "gmail"] as const) assert.equal(groupMemberPolicy(platform).direct, false);
});

test("group additions enforce workspace/account scope, receipts, locks and verified manual identities", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "group-members-test-"));
  const databaseUrl = `file:${path.join(directory, "test.db")}`;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const owner = await db.user.create({ data: { email: "you@omni-crm.local" } });
    const a = await db.account.create({ data: { userId: owner.id, platform: "telegram" } });
    const b = await db.account.create({ data: { userId: owner.id, platform: "telegram" } });
    const chat = await db.conversation.create({ data: { platform: "telegram", account: { connect: { id: a.id } }, externalId: "555", contact: { create: { name: "Fixture group", handle: "group", isGroup: true, externalKey: "telegram:group555" } } } });
    const people = [];
    for (let index = 1; index <= 3; index++) {
      const person = await db.contact.create({ data: { name: `Fixture ${index}`, handle: `@fixture${index}`, externalKey: `telegram:${index}` } });
      await db.conversation.create({ data: { accountId: index === 3 ? b.id : a.id, platform: "telegram", externalId: String(index), contactId: person.id } });
      people.push(person);
    }
    assert.deepEqual((await db.contact.findMany({ where: groupContactScope(a.id, "telegram"), orderBy: { name: "asc" } })).map(c => c.id), people.slice(0, 2).map(c => c.id));
    const groupSender = await db.contact.create({ data: { name: "Group-only fixture", handle: "@groupfixture", externalKey: "telegram:7" } });
    const otherGroup = await db.conversation.create({ data: { platform: "telegram", account: { connect: { id: a.id } }, externalId: "556", contact: { create: { name: "Other fixture group", handle: "othergroup", isGroup: true, externalKey: "telegram:group556" } } } });
    await db.message.create({ data: { conversationId: otherGroup.id, senderContactId: groupSender.id, direction: "in", body: "Synthetic message", createdAt: new Date(Date.now() + 1000) } });
    const route = await import("../src/app/api/conversations/[id]/participants/route");
    const response = await route.GET(new Request("http://localhost/api/participants"), { params: { id: chat.id } });
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.deepEqual(new Set(listing.candidates.map((p: any) => p.id)), new Set([...people.slice(0, 2).map(p => p.id), groupSender.id]), "API suggestions use the group's exact account, including people seen in other groups");
    assert.equal(listing.candidates[0].id, groupSender.id, "recent activity sorts people newest first");
    const searched = await route.GET(new Request("http://localhost/api/participants?q=fixture1"), { params: { id: chat.id } });
    assert.deepEqual((await searched.json()).candidates.map((p: any) => p.id), [people[0].id]);
    assert.equal((await route.GET(new Request("http://localhost/api/participants", { headers: { "x-tmd-guest": "1" } }), { params: { id: chat.id } })).status, 403);
    assert.equal((await route.POST(new Request("http://localhost/api/participants", { method: "POST", headers: { origin: "https://other.invalid", "x-omni-group-action": "1" }, body: "{}" }), { params: { id: chat.id } })).status, 403);
    let calls = 0;
    let fail = false;
    let release: (() => void) | undefined;
    let wait = false;
    let lookupId = "telegram:9";
    const adapter = { platform: "telegram", getStatus: () => ({ platform: "telegram", state: "ready" }),
      resolveDirectContact: async () => ({ externalKey: lookupId, name: "Manual person", handle: "@manual", chatExternalId: "9" }),
      addGroupMember: async (id: string) => {
        assert.equal(id, "555"); calls++;
        if (wait) await new Promise<void>(resolve => { release = resolve; });
        if (fail) throw new Error("Synthetic lost connection");
        return { status: "added", detail: "Added" };
      },
    } as unknown as Adapter;
    const ledger = new DurableRecords<any>(path.join(directory, "ledger"));
    const make = () => new GroupMembership(db, id => id === a.id ? adapter : undefined, (_a, task) => task(), ledger);
    const service = make();
    const input = { userId: owner.id, conversationId: chat.id, requestId: "fixture-request-0001", selections: [{ contactId: people[0].id }] };
    await assert.rejects(service.execute({ ...input, userId: "other-owner" }), /workspace/);
    await assert.rejects(service.execute({ ...input, selections: [{ contactId: people[2].id }] }), /connected account/);
    assert.equal(calls, 0);
    await Promise.all([service.execute(input), service.execute(input)]);
    assert.equal(calls, 1);
    await make().execute(input);
    assert.equal(calls, 1, "completed receipt survives worker restart");
    await assert.rejects(service.execute({ ...input, selections: [{ contactId: people[1].id }] }), /different selection/);
    const result = await service.resolve({ userId: owner.id, conversationId: chat.id, target: "@manual" });
    assert.equal(result.expectedKey, "telegram:9");
    lookupId = "telegram:10";
    const changed = await service.execute({ ...input, requestId: "fixture-request-0002", selections: [{ target: "@manual", expectedKey: result.expectedKey }] });
    assert.equal(changed[0].status, "not_added"); assert.equal(calls, 1, "reassigned username is not added");
    fail = true;
    const partial = await service.execute({ ...input, requestId: "fixture-request-0003", selections: people.slice(0, 2).map(p => ({ contactId: p.id })) });
    assert.equal(partial[0].status, "unknown"); assert.equal(partial[1].status, "not_added"); assert.equal(calls, 2, "uncertain action stops the remaining batch");
    fail = false; wait = true;
    const active = service.execute({ ...input, requestId: "fixture-request-0004" });
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(service.execute({ ...input, requestId: "fixture-request-0005" }), /still running/);
    await assert.rejects(make().execute({ ...input, requestId: "fixture-request-0004" }), /interrupted/, "pending receipt never blindly replays after restart");
    release(); await active; wait = false;
    await db.conversation.update({ where: { id: chat.id }, data: { accountId: b.id } });
    await assert.rejects(service.execute({ ...input, requestId: "fixture-request-0006" }), /Reconnect/, "never use another account's adapter");
  } finally {
    await db.$disconnect();
    const globalDb = (globalThis as any).prisma;
    if (globalDb) await globalDb.$disconnect();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
