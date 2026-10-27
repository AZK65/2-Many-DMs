import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isPlaceholderIdentity, whatsappDisplayName } from "./whatsapp-identity";

test("placeholder detection accepts names but not phone and linked IDs", () => {
  for (const value of ["", "Group chat", "WhatsApp member", "+1 (202) 555-0147", "123456789@lid"]) assert.ok(isPlaceholderIdentity(value));
  for (const value of ["Corso X Finity", "Nick", "10XECOM"]) assert.equal(isPlaceholderIdentity(value), false);
  assert.equal(whatsappDisplayName({ name: "Saved name", pushname: "Profile name" }), "Saved name");
});

test("identity persistence cannot downgrade names and repairs placeholders without touching messages", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "omni-wa-identity-test-"));
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  let store: typeof import("./store") | undefined;
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    store = await import("./store");
    await store.prismaReady;
    const { prisma, persistInbound, repairWhatsAppIdentities } = store;
    const user = await prisma.user.create({ data: { email: "test@example.invalid" } });
    const account = await prisma.account.create({ data: { userId: user.id, platform: "whatsapp" } });
    const message: import("./adapters/types").InboundMessage = {
      accountId: account.id, platform: "whatsapp", chatExternalId: "123@g.us", messageExternalId: "whatsapp:123@g.us:first",
      direction: "in", body: "fixture", timestamp: new Date(), isGroup: true,
      contact: { externalKey: "whatsapp:123@g.us", name: "Group chat", handle: "Group" },
      sender: { externalKey: "whatsapp:456@lid", name: "+12025550147" },
    };
    await persistInbound(message);
    await repairWhatsAppIdentities("other-account", [{ externalKey: message.contact.externalKey, name: "Wrong account" }]);
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { externalKey: message.contact.externalKey } })).name, "Group chat");
    await repairWhatsAppIdentities(account.id, [{ externalKey: message.contact.externalKey, name: "Real group" }]);
    await persistInbound({ ...message, historical: true, sender: { ...message.sender!, name: "Alice" } });
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { externalKey: message.contact.externalKey } })).name, "Real group");
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { externalKey: message.sender!.externalKey } })).name, "Alice");
    await repairWhatsAppIdentities(account.id, [{ externalKey: message.sender!.externalKey, name: "Different profile name" }]);
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { externalKey: message.sender!.externalKey } })).name, "Alice");
    assert.equal(await prisma.message.count(), 1);
    assert.equal((await prisma.conversation.findFirstOrThrow()).unread, 1);
  } finally {
    await store?.prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
