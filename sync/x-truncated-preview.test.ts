import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { xPreviewMatchesText } from "./x-message-text";
import { xHistoryMatchesPreview } from "./x-history";
import { coalesceXPreviewRuns, reconcileXPreviewCopies, reconcileXVerifiedSnapshot, reconcileXAccountPreviews } from "./x-preview-reconciliation";

// Synthetic text only. Never copy a customer's DM into public regression tests.
const prefix = "A detailed request about an account, with several questions and supporting context. ".repeat(3).slice(0, 200);
const full = `${prefix} Here is the rest of the message, which the inbox does not show.`;
const at = Date.parse("2026-10-29T13:14:00Z");

test("X previews match the exact 200-character boundary, not arbitrary prefixes", () => {
  assert.equal(xPreviewMatchesText(prefix, full), true);
  const spaceCut = `${"a".repeat(199)} more context`;
  assert.equal(xPreviewMatchesText(spaceCut.slice(0, 200).trim(), spaceCut), true);
  const emoji = `🙂${"a".repeat(198)} more context`;
  assert.equal(xPreviewMatchesText(Array.from(emoji).slice(0, 200).join("").trim(), emoji), true);
  assert.equal(xPreviewMatchesText(emoji.slice(0, 200), emoji), true);
  assert.equal(xPreviewMatchesText(full.slice(0, 199), full), false);
  assert.equal(xPreviewMatchesText("yes", "yes please"), false);
  assert.equal(xPreviewMatchesText("a short standalone message", "a short standalone message followed by another thought"), false);
  assert.equal(xPreviewMatchesText(prefix, `${prefix.slice(0, -1)}! different ending`), false);
  assert.equal(xPreviewMatchesText(full, prefix), false);
  assert.equal(xHistoryMatchesPreview([{ id: "native", text: full, direction: "in", timestamp: at }], { preview: prefix, direction: "in", timestamp: at }), true);
  assert.equal(xHistoryMatchesPreview([{ id: "native", text: full, direction: "out", timestamp: at }], { preview: prefix, direction: "in", timestamp: at }), false);
  assert.equal(xHistoryMatchesPreview([{ id: "native", text: full, direction: "in", timestamp: at - 86400000 }], { preview: prefix, direction: "in", timestamp: at }), false);
});

test("clipped previews reconcile across chats without losing native messages or protected data", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "x-clipped-preview-test-"));
  const previous = { url: process.env.DATABASE_URL, data: process.env.DATA_DIR };
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  process.env.DATA_DIR = directory;
  let store: typeof import("./store") | undefined;
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    store = await import("./store");
    await store.prismaReady;
    const { prisma, persistInbound } = store;
    const user = await prisma.user.create({ data: { email: "preview-test@example.invalid" } });
    const account = await prisma.account.create({ data: { userId: user.id, platform: "x" } });
    const contact = await prisma.contact.create({ data: { name: "Synthetic request", handle: "synthetic-request" } });
    const proof = { preview: prefix, direction: "in" as const, checkedAt: at + 3 * 3600000 };
    const createChat = async (id: string, inboxCategory = "general") => {
      const chat = await prisma.conversation.create({ data: { platform: "x", externalId: id, accountId: account.id, contactId: contact.id, inboxCategory } });
      const native = await prisma.message.create({ data: { conversationId: chat.id, externalKey: `x:${randomUUID()}`, body: full, direction: "in", createdAt: new Date(at) } });
      const copy = { conversationId: chat.id, direction: "in", body: prefix, createdAt: new Date(at + 65 * 60000) };
      return { chat, native, copy };
    };
    const proofs = new Map();
    for (const category of ["general", "spam"]) {
      const { copy } = await createChat(category, category);
      await prisma.message.createMany({ data: Array.from({ length: 9 }, (_, i) => ({ ...copy, externalKey: `x:preview:${category}-${i}`, createdAt: new Date(at + (i + 1) * 9 * 60000) })) });
      proofs.set(category, proof);
    }
    const report = await reconcileXAccountPreviews(prisma, account.id, proofs);
    assert.equal(report.changed, 2);
    assert.equal(report.removed, 18);
    assert.equal((await reconcileXAccountPreviews(prisma, account.id, proofs)).removed, 0, "restart-safe, idempotent cleanup");
    assert.equal(await prisma.message.count(), 2);
    for (const row of await prisma.message.findMany()) { assert.equal(row.body, full); assert.equal(row.createdAt.getTime(), at); }
    const backups = readdirSync(path.join(directory, ".x_preview_backups")).flatMap(name => JSON.parse(readFileSync(path.join(directory, ".x_preview_backups", name), "utf8")).duplicates);
    assert.equal(backups.length, 18, "all removed copies can be recovered");

    for (const kind of ["ambiguous", "wrong-direction", "intervening", "pinned", "translated", "original", "media", "referenced", "stale", "unproven", "short-prefix"]) {
      const { native, copy } = await createChat(kind);
      const previewKey = `x:preview:${kind}`;
      const row = await prisma.message.create({ data: { ...copy, externalKey: previewKey,
        ...(kind === "wrong-direction" ? { direction: "out" } : {}),
        ...(kind === "pinned" ? { pinnedAt: new Date(at) } : {}),
        ...(kind === "translated" ? { translatedBody: "Saved translation" } : {}),
        ...(kind === "original" ? { originalBody: "Saved draft" } : {}),
        ...(kind === "media" ? { mediaType: "image" } : {}),
        ...(kind === "short-prefix" ? { body: full.slice(0, 40) } : {}),
      } });
      if (["ambiguous", "intervening", "referenced"].includes(kind)) await prisma.message.create({ data: { ...copy, externalKey: `x:${randomUUID()}`, body: kind === "ambiguous" ? `${prefix} Different real ending.` : "A different message", createdAt: new Date(at + 60000), ...(kind === "referenced" ? { replyToExternalKey: previewKey } : {}) } });
      const checked = kind === "stale" ? at : proof.checkedAt;
      assert.equal((await reconcileXAccountPreviews(prisma, account.id, kind === "unproven" ? new Map() : new Map([[kind, { ...proof, checkedAt: checked }]]))).removed, 0, kind);
      assert.ok(await prisma.message.findUnique({ where: { id: row.id } }), kind);
      assert.ok(await prisma.message.findUnique({ where: { id: native.id } }), kind);
    }

    const { native, copy } = await createChat("nearby");
    await prisma.message.create({ data: { ...copy, externalKey: "x:preview:nearby", createdAt: new Date(at + 60000) } });
    assert.equal(await reconcileXPreviewCopies(prisma, account.id, "nearby", [native.externalKey!]), 1);
    await prisma.message.create({ data: { ...copy, externalKey: "x:preview:nearby-run", createdAt: new Date(at + 60000) } });
    assert.equal(await coalesceXPreviewRuns(prisma, account.id, "nearby"), 1);
    await prisma.message.create({ data: { ...copy, externalKey: `x:${randomUUID()}`, body: `${prefix} Another native message.`, createdAt: new Date(at - 86400000) } });
    await prisma.message.create({ data: { ...copy, externalKey: "x:preview:ambiguous-nearby", createdAt: new Date(at + 60000) } });
    assert.equal(await reconcileXPreviewCopies(prisma, account.id, "nearby", [native.externalKey!]), 0, "check ambiguity outside the current history pass");
    assert.equal(await coalesceXPreviewRuns(prisma, account.id, "nearby"), 0);

    const inbound = { accountId: account.id, platform: "x" as const, chatExternalId: "live-clipped", direction: "in" as const, body: prefix, timestamp: new Date(at), contact: { externalKey: "x:synthetic-contact", name: "Synthetic contact", handle: "synthetic-contact" } };
    await persistInbound({ ...inbound, messageExternalId: "x:preview:first" });
    const first = await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:preview:first" } });
    const key = `x:${randomUUID()}`;
    await persistInbound({ ...inbound, messageExternalId: key, body: full, historical: true });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: key } })).id, first.id, "native history upgrades the preview in place");
    await persistInbound({ ...inbound, messageExternalId: "x:preview:after-restart", timestamp: new Date(at + 86400000) });
    assert.equal(await prisma.message.count({ where: { conversationId: first.conversationId } }), 1, "late clipped snapshot cannot recreate a duplicate");
    await persistInbound({ ...inbound, messageExternalId: `x:${randomUUID()}`, body: full, timestamp: new Date(at + 86400000), historical: true });
    assert.equal(await prisma.message.count({ where: { conversationId: first.conversationId } }), 2, "genuine native repeats stay separate");

    const { copy: failureCopy } = await createChat("backup-failure");
    await prisma.message.create({ data: { ...failureCopy, externalKey: "x:preview:backup-failure" } });
    assert.equal(await reconcileXVerifiedSnapshot(prisma, "different-account", "backup-failure", proof), 0);
    process.env.DATA_DIR = path.join(directory, "test.db");
    await assert.rejects(reconcileXVerifiedSnapshot(prisma, account.id, "backup-failure", proof));
    assert.ok(await prisma.message.findUnique({ where: { externalKey: "x:preview:backup-failure" } }));
  } finally {
    await store?.prisma.$disconnect();
    if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
    if (previous.data === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous.data;
    rmSync(directory, { recursive: true, force: true });
  }
});
