import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { InboundMessage } from "./adapters/types";
import { recordDeliveryReceipt } from "./delivery-receipt";
import { coalesceXPreviewRuns, reconcileXPreviewCopies, reconcileXVerifiedSnapshot, reconcileXAccountPreviews, xSnapshotProofs } from "./x-preview-reconciliation";

test("X history repairs dates without unread inflation, duplicates, or changing local sends", async () => {
  // A new empty database, never a copy of the user's chats or the live DB.
  const directory = mkdtempSync(path.join(tmpdir(), "omni-x-store-test-"));
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  let store: typeof import("./store") | undefined;
  try {
    const create = spawnSync("sqlite3", [path.join(directory, "test.db"), "PRAGMA user_version=0;"], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
      cwd: process.cwd(), env: process.env, encoding: "utf8",
    });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    store = await import("./store");
    await store.prismaReady;
    const { prisma, persistInbound, reconcileXConversationTime } = store;
    const user = await prisma.user.create({ data: { email: "x-test@example.invalid" } });
    const account = await prisma.account.create({ data: { userId: user.id, platform: "x" } });
    const today = new Date("2026-10-07T15:30:00Z");
    const old = new Date("2026-09-10T15:30:00Z");
    const message: InboundMessage = {
      accountId: account.id, platform: "x", chatExternalId: "test-chat", messageExternalId: "x:test-native",
      direction: "in", body: "fixture message", timestamp: today,
      contact: { externalKey: "x:test-contact", name: "Test", handle: "test" },
    };
    await persistInbound(message); // Simulate a row imported with the old bad clock.
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { accountId: account.id } });
    assert.equal(conversation.unread, 1);
    await persistInbound({ ...message, historical: true, timestampVerified: true, timestamp: old });
    await reconcileXConversationTime(account.id, "test-chat", old.getTime());
    assert.equal(await prisma.message.count(), 1);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: message.messageExternalId } })).createdAt.getTime(), old.getTime());
    let repaired = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    assert.equal(repaired.lastMessageAt.getTime(), old.getTime());
    assert.equal(repaired.unread, 1);

    await persistInbound({ ...message, messageExternalId: "x:another-historical", historical: true, timestampVerified: true });
    repaired = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    assert.equal(repaired.lastMessageAt.getTime(), old.getTime(), "history must not bump recency");
    assert.equal(repaired.unread, 1);

    await prisma.message.create({ data: {
      id: "client_test-send", externalKey: "x:local-send", conversationId: conversation.id,
      direction: "out", body: "local fixture", createdAt: today, deliveryStatus: "sent",
    } });
    await reconcileXConversationTime(account.id, "test-chat", old.getTime());
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).lastMessageAt.getTime(), today.getTime());
    await persistInbound({ ...message, messageExternalId: "x:local-send", direction: "out", body: "local fixture", historical: true, timestampVerified: true, timestamp: old });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: "client_test-send" } })).createdAt.getTime(), today.getTime());

    await persistInbound({ ...message, messageExternalId: "x:preview:photo-fixture", body: "Sent a photo" });
    const photoPreview = await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:preview:photo-fixture" } });
    const photo: InboundMessage = { ...message, historical: true, timestampVerified: true, messageExternalId: "x:photo-native", body: "", media: { type: "image", url: "/media/photo-fixture.png", name: "Photo.png" } };
    await persistInbound(photo);
    const importedPhoto = await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:photo-native" } });
    assert.equal(importedPhoto.id, photoPreview.id, "attachment must replace its text-only preview");
    assert.equal(importedPhoto.mediaUrl, "/media/photo-fixture.png");
    assert.equal(importedPhoto.body, "");
    const beforeRepeat = await prisma.message.count();
    await persistInbound(photo);
    assert.equal(await prisma.message.count(), beforeRepeat);

    const shortText = "Here is the complete information…";
    const fullText = "Here is the complete information you requested. Meet at 5:30 PM";
    await persistInbound({ ...message, messageExternalId: "x:preview:truncated", body: shortText });
    const shortRow = await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:preview:truncated" } });
    await persistInbound({ ...message, messageExternalId: "x:full-reply", body: fullText, historical: true });
    const fullRow = await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:full-reply" } });
    assert.equal(fullRow.id, shortRow.id, "upgrade the visible preview in place");
    assert.equal(fullRow.body, fullText);
    await persistInbound({ ...message, messageExternalId: "x:full-reply", body: shortText, historical: true });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:full-reply" } })).body, fullText);
    const countAfterFull = await prisma.message.count();
    await persistInbound({ ...message, messageExternalId: "x:preview:late-truncated", body: shortText });
    assert.equal(await prisma.message.count(), countAfterFull, "late truncated preview must not duplicate a full reply");

    await persistInbound({ ...message, messageExternalId: "x:hydrating-native", body: shortText, historical: true });
    await persistInbound({ ...message, messageExternalId: "x:hydrating-native", body: fullText, historical: true });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:hydrating-native" } })).body, fullText);

    await prisma.message.update({ where: { id: fullRow.id }, data: { body: `${fullText}\n11:45 AM\n11:45 AM` } });
    await persistInbound({ ...message, messageExternalId: "x:full-reply", body: fullText, historical: true });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: fullRow.id } })).body, fullText, "fresh native text repairs the known timestamp-wrapper corruption");

    const { XAdapter } = await import("./adapters/x");
    const warm = new XAdapter() as any;
    const warmPage = { isClosed: () => false, url: () => "https://x.com/i/chat/test-chat" };
    const warmWrites: InboundMessage[] = [];
    Object.assign(warm, { accountId: account.id, sendPage: warmPage, onMessage: async (m: InboundMessage) => { warmWrites.push(m); } });
    warm.readMessageWindow = async (page: unknown, options: unknown) => {
      assert.equal(page, warmPage);
      assert.deepEqual(options, { passive: true });
      return [{ id: "warm-native", text: "Complete warm reply", direction: "in", timestamp: today.getTime() }];
    };
    await warm.syncWarmConversation(() => true);
    assert.equal(warmWrites[0].body, "Complete warm reply");
    assert.equal(warmWrites[0].messageExternalId, "x:warm-native");
    await warm.syncWarmConversation(() => false);
    assert.equal(warmWrites.length, 1, "retired/cooling/sending snapshots must not publish");
    warm.readMessageWindow = async () => {
      warm.sendPage = undefined;
      return [{ id: "stale-native", text: "Wrong route", direction: "in", timestamp: today.getTime() }];
    };
    await warm.syncWarmConversation(() => true);
    assert.equal(warmWrites.length, 1, "route changes during an async read must discard results");
    await persistInbound({ ...photo, messageExternalId: "x:document-native", media: { type: "file", url: "/media/document-fixture.pdf", name: "Report.pdf" } });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:document-native" } })).mediaName, "Report.pdf");

    const gif = { ...message, historical: true, messageExternalId: "x:gif-native", body: "", media: { type: "video" as const, url: "/media/gif-fixture.mp4" } };
    await persistInbound(gif);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: gif.messageExternalId } })).mediaIsGif, false);
    // Recover native GIF metadata even when the file URL hasn't changed.
    await persistInbound({ ...gif, media: { ...gif.media, isGif: true } });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: gif.messageExternalId } })).mediaIsGif, true);
    await persistInbound(gif);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: gif.messageExternalId } })).mediaIsGif, true, "partial history must not erase animation metadata");
    await persistInbound({ ...gif, messageExternalId: "x:new-gif", media: { ...gif.media, isGif: true } });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { externalKey: "x:new-gif" } })).mediaIsGif, true);

    // A native inbox echo must confirm, not merely deduplicate, a local send.
    for (const status of ["sent", "unconfirmed"]) {
      const id = `client_echo-${status}`;
      const body = `outgoing ${status}`;
      const at = new Date(today.getTime() + (status === "sent" ? 60_000 : 120_000));
      const provisional = `x:test-chat:pending:${status}`;
      await prisma.message.create({ data: {
        id, conversationId: conversation.id, direction: "out", body,
        externalKey: provisional, deliveryStatus: status, deliveryError: "old warning", createdAt: at,
      } });
      const count = await prisma.message.count();
      const echo = { ...message, direction: "out" as const, body, timestamp: at, timestampVerified: true, messageExternalId: `x:preview:echo-${status}` };
      await persistInbound(echo);
      let sent = await prisma.message.findUniqueOrThrow({ where: { id } });
      assert.equal(sent.deliveryStatus, "sent");
      assert.equal(sent.deliveryError, null);
      assert.equal(sent.externalKey, echo.messageExternalId);
      assert.equal(await prisma.message.count(), count);

      // The adapter can return after the echo. Its provisional ID must not
      // replace the receipt, otherwise the watchdog would downgrade it again.
      await recordDeliveryReceipt(prisma, id, { messageExternalId: provisional, timestamp: at.toISOString() });
      assert.equal((await prisma.message.findUniqueOrThrow({ where: { id } })).externalKey, echo.messageExternalId);
      const watchdog = await prisma.message.updateMany({ where: { id, externalKey: provisional, deliveryStatus: "sent" }, data: { deliveryStatus: "unconfirmed" } });
      assert.equal(watchdog.count, 0);
      await persistInbound({ ...echo, historical: true, messageExternalId: `x:native-echo-${status}` });
      sent = await prisma.message.findUniqueOrThrow({ where: { id } });
      assert.equal(sent.externalKey, `x:native-echo-${status}`);
      assert.equal(sent.deliveryStatus, "sent");
      assert.equal(await prisma.message.count(), count);
    }

    const unsafeAt = new Date(today.getTime() + 300_000);
    await prisma.message.create({ data: {
      id: "client_old-repeat", conversationId: conversation.id, direction: "out", body: "repeated text",
      externalKey: "x:test-chat:pending:repeat", deliveryStatus: "unconfirmed", createdAt: unsafeAt,
    } });
    await persistInbound({ ...message, direction: "out", body: "repeated text", historical: true, timestampVerified: true, timestamp: old, messageExternalId: "x:preview:old-repeat" });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: "client_old-repeat" } })).deliveryStatus, "unconfirmed", "old repeated text must not confirm a new send");

    await prisma.message.create({ data: {
      id: "client_photo", conversationId: conversation.id, direction: "out", body: "", mediaType: "image",
      externalKey: "x:test-chat:pending:photo", deliveryStatus: "unconfirmed", createdAt: new Date(unsafeAt.getTime() + 60_000),
    } });
    await persistInbound({ ...message, direction: "out", body: "Sent a photo", timestampVerified: true, timestamp: new Date(unsafeAt.getTime() + 60_000), messageExternalId: "x:preview:generic-photo" });
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: "client_photo" } })).deliveryStatus, "unconfirmed", "generic photo previews cannot confirm an exact attachment");

    for (const preexistingEcho of [false, true]) {
      const suffix = String(preexistingEcho);
      const at = new Date(unsafeAt.getTime() + 120_000);
      const nativeAt = new Date(at.getTime() - 45_000); // X shows minute precision.
      const original = `https://example.com/join?code=${suffix}\nJoin here`;
      const rendered = original.replace("https://", "");
      const nativeKey = `x:native-link-${suffix}`;
      await prisma.message.create({ data: {
        id: `client_link-${suffix}`, conversationId: conversation.id, direction: "out", body: original,
        externalKey: `x:test-chat:pending:link-${suffix}`, deliveryStatus: "unconfirmed", createdAt: at,
      } });
      if (preexistingEcho) await prisma.message.create({ data: {
        conversationId: conversation.id, direction: "out", body: rendered,
        externalKey: nativeKey, deliveryStatus: "sent", createdAt: nativeAt,
      } });
      const count = await prisma.message.count();
      await persistInbound({ ...message, direction: "out", body: rendered, timestamp: nativeAt, timestampVerified: true, historical: true, messageExternalId: nativeKey });
      const repairedLink = await prisma.message.findUniqueOrThrow({ where: { id: `client_link-${suffix}` } });
      assert.equal(repairedLink.deliveryStatus, "sent");
      assert.equal(repairedLink.externalKey, nativeKey);
      assert.equal(repairedLink.body, original, "preserve the full sent URL");
      assert.equal(await prisma.message.count(), count - (preexistingEcho ? 1 : 0));
    }

    const roundedAt = new Date(today.getTime() + 900000);
    const nativeKey = "x:11111111-1111-4111-8111-111111111111";
    await persistInbound({ ...message, body: "rounded preview", timestamp: roundedAt, messageExternalId: nativeKey });
    const roundedCount = await prisma.message.count();
    await persistInbound({ ...message, body: "rounded preview", timestamp: new Date(roundedAt.getTime() + 64027), messageExternalId: "x:preview:rounded-new" });
    assert.equal(await prisma.message.count(), roundedCount, "poll jitter must not duplicate a native message");
    await persistInbound({ ...message, body: "rounded preview", timestampVerified: false, timestamp: new Date(roundedAt.getTime() + 30 * 60000), messageExternalId: "x:preview:drift-new" });
    assert.equal(await prisma.message.count(), roundedCount, "relative clock drift cannot manufacture another copy of unchanged text");
    await persistInbound({ ...message, body: "A genuinely changed preview", timestampVerified: false, timestamp: new Date(roundedAt.getTime() + 30 * 60000), messageExternalId: "x:preview:changed" });
    assert.ok(await prisma.message.findUnique({ where: { externalKey: "x:preview:changed" } }));
    await persistInbound({ ...message, body: "A genuinely changed preview", timestampVerified: true, timestamp: new Date(roundedAt.getTime() + 40 * 60000), messageExternalId: "x:preview:verified-repeat" });
    assert.equal(await prisma.message.findUnique({ where: { externalKey: "x:preview:verified-repeat" } }), null, "a changed inbox clock alone cannot prove a second identical DM");
    const repeatKey = "x:99999999-9999-4999-8999-999999999999";
    await persistInbound({ ...message, body: "A genuinely changed preview", timestampVerified: true, timestamp: new Date(roundedAt.getTime() + 40 * 60000), messageExternalId: repeatKey, historical: true });
    assert.ok(await prisma.message.findUnique({ where: { externalKey: repeatKey } }), "a distinct native ID still creates the genuine repeat");
    await prisma.message.create({ data: { conversationId: conversation.id, externalKey: "x:preview:legacy-duplicate", body: "rounded preview", direction: "in", createdAt: new Date(roundedAt.getTime() + 64027) } });
    const pinned = await prisma.message.create({ data: { conversationId: conversation.id, externalKey: "x:preview:pinned-duplicate", body: "rounded preview", direction: "in", createdAt: roundedAt, pinnedAt: roundedAt } });
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    try {
      assert.equal(await reconcileXPreviewCopies(prisma, account.id, "test-chat", [nativeKey]), 1);
      assert.ok(await prisma.message.findUnique({ where: { id: pinned.id } }), "annotated previews must be preserved");
      assert.ok(await prisma.message.findUnique({ where: { externalKey: nativeKey } }), "native messages must never be removed");
      const secondNativeKey = "x:22222222-2222-4222-8222-222222222222";
      await persistInbound({ ...message, body: "rounded preview", timestamp: roundedAt, messageExternalId: secondNativeKey, historical: true });
      assert.equal(await prisma.message.count({ where: { externalKey: { in: [nativeKey, secondNativeKey] } } }), 2, "identical native messages remain separate");
      await prisma.message.create({ data: { conversationId: conversation.id, externalKey: "x:preview:ambiguous-repeat", body: "rounded preview", direction: "in", createdAt: roundedAt } });
      assert.equal(await reconcileXPreviewCopies(prisma, account.id, "test-chat", [nativeKey, secondNativeKey]), 0, "do not guess which genuine repeated message a preview belongs to");

      const driftKey = "x:33333333-3333-4333-8333-333333333333";
      const endKey = "x:44444444-4444-4444-8444-444444444444";
      const since = roundedAt.getTime() + 60 * 60000;
      const until = since + 60 * 60000;
      await prisma.message.createMany({ data: [
        { conversationId: conversation.id, externalKey: driftKey, direction: "in", body: "Request body", createdAt: new Date(since) },
        { conversationId: conversation.id, externalKey: endKey, direction: "out", body: "Native reply", createdAt: new Date(until) },
        { conversationId: conversation.id, externalKey: "x:preview:old-drift", direction: "in", body: "Request body", createdAt: new Date(since + 24 * 60000) },
      ] });
      assert.equal(await reconcileXPreviewCopies(prisma, account.id, "test-chat", [driftKey, endKey]), 0, "unread gaps never justify wide deduplication");
      assert.equal(await reconcileXPreviewCopies(prisma, account.id, "test-chat", [driftKey, endKey], { since: since + 1000, until }), 0, "native must fall within the verified interval");
      const intervening = "x:55555555-5555-4555-8555-555555555555";
      await prisma.message.create({ data: { conversationId: conversation.id, externalKey: intervening, direction: "out", body: "", mediaType: "image", createdAt: new Date(since + 5000) } });
      assert.equal(await reconcileXPreviewCopies(prisma, account.id, "test-chat", [driftKey, endKey, intervening], { since, until }), 0, "even an intervening attachment blocks ambiguous cleanup");
      await prisma.message.delete({ where: { externalKey: intervening } });
      assert.equal(await reconcileXPreviewCopies(prisma, account.id, "test-chat", [driftKey, endKey], { since, until }), 1, "complete native history proves the stale request preview drifted");
      assert.equal(await prisma.message.count({ where: { externalKey: { in: [driftKey, endKey] } } }), 2);

      // Accepted requests can lose their pre-acceptance history on X. Collapse
      // only a contiguous generated run anchored by a nearby saved native ID.
      const runKey = "x:66666666-6666-4666-8666-666666666666";
      const runStart = until + 3600000;
      await prisma.message.createMany({ data: [
        { conversationId: conversation.id, externalKey: runKey, direction: "in", body: "Request run", createdAt: new Date(runStart) },
        ...[60000, 300000, 1500000].map((offset, i) => ({ conversationId: conversation.id, externalKey: `x:preview:run-${i}`, direction: "in", body: "Request run", createdAt: new Date(runStart + offset) })),
        { conversationId: conversation.id, externalKey: "x:preview:run-pinned", direction: "in", body: "Request run", createdAt: new Date(runStart + 1600000), pinnedAt: roundedAt },
        { conversationId: conversation.id, externalKey: "x:77777777-7777-4777-8777-777777777777", direction: "in", body: "Request run", createdAt: new Date(runStart + 1700000) },
        { conversationId: conversation.id, externalKey: "x:preview:run-unanchored", direction: "in", body: "Request run", createdAt: new Date(runStart + 2000000) },
      ] });
      await coalesceXPreviewRuns(prisma, account.id, "test-chat");
      assert.equal(await prisma.message.count({ where: { externalKey: { in: [0, 1, 2].map(i => `x:preview:run-${i}`) } } }), 0);
      for (const key of [runKey, "x:77777777-7777-4777-8777-777777777777", "x:preview:run-pinned", "x:preview:run-unanchored"]) assert.ok(await prisma.message.findUnique({ where: { externalKey: key } }), key);

      // One-message requests have no min/max history interval. Reconcile them
      // globally from completed native-history checkpoints, not clock proximity.
      const requestAt = runStart + 86400000;
      for (const chat of ["request-a", "request-b"]) {
        const c = await prisma.conversation.create({ data: { platform: "x", accountId: account.id, contactId: conversation.contactId, externalId: chat } });
        await prisma.message.createMany({ data: [
          { conversationId: c.id, direction: "in", body: "A complete\n\nrequest: with details", externalKey: chat === "request-a" ? "x:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "x:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", createdAt: new Date(requestAt) },
          { conversationId: c.id, direction: "in", body: "A complete\nrequest: with details", externalKey: `x:preview:${chat}`, createdAt: new Date(requestAt + 61 * 60000) },
        ] });
      }
      const checkedAt = requestAt + 2 * 86400000;
      const signature = `in:A complete\nrequest: with details:${requestAt + 61 * 60000}`;
      const proofs = xSnapshotProofs([["spam:request-a", signature], ["general:request-b", signature], ["spam:partial-request", signature]], new Map([["spam:request-a", checkedAt], ["general:request-b", checkedAt]]));
      assert.equal(proofs.has("partial-request"), false, "uncompleted history reads are not evidence");
      const report = await reconcileXAccountPreviews(prisma, account.id, proofs);
      assert.ok(report.changed >= 2, "repair scans multiple idle chats, not only the opened DM");
      for (const chat of ["request-a", "request-b"]) assert.equal(await prisma.message.count({ where: { externalKey: `x:preview:${chat}` } }), 0);
      assert.equal((await reconcileXAccountPreviews(prisma, account.id, proofs)).removed, 0, "repair is idempotent");

      const c = await prisma.conversation.findFirstOrThrow({ where: { externalId: "request-a" } });
      const copy = { conversationId: c.id, direction: "in", body: "A complete\nrequest: with details", createdAt: new Date(requestAt + 61 * 60000) };
      const proof = proofs.get("request-a")!;
      await prisma.message.create({ data: { ...copy, externalKey: "x:preview:future-proof" } });
      assert.equal(await reconcileXVerifiedSnapshot(prisma, account.id, "request-a", { ...proof, checkedAt: requestAt }), 0, "stale evidence cannot remove a newer observation");
      assert.equal(await reconcileXVerifiedSnapshot(prisma, "another-account", "request-a", proof), 0, "account isolation");
      await prisma.message.create({ data: { ...copy, body: "Different reply", direction: "out", externalKey: "x:cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: new Date(requestAt + 60000) } });
      assert.equal(await reconcileXVerifiedSnapshot(prisma, account.id, "request-a", proof), 0, "never infer across an intervening different message");
      await prisma.message.delete({ where: { externalKey: "x:cccccccc-cccc-4ccc-8ccc-cccccccccccc" } });
      await prisma.message.create({ data: { ...copy, externalKey: "x:dddddddd-dddd-4ddd-8ddd-dddddddddddd", createdAt: new Date(requestAt + 60000) } });
      assert.equal(await reconcileXVerifiedSnapshot(prisma, account.id, "request-a", proof), 0, "multiple genuine native repeats remain ambiguous and intact");
      await prisma.message.delete({ where: { externalKey: "x:dddddddd-dddd-4ddd-8ddd-dddddddddddd" } });
      await prisma.message.update({ where: { externalKey: "x:preview:future-proof" }, data: { pinnedAt: new Date(requestAt) } });
      assert.equal(await reconcileXVerifiedSnapshot(prisma, account.id, "request-a", proof), 0, "pinned copies remain intact");
      await prisma.message.update({ where: { externalKey: "x:preview:future-proof" }, data: { pinnedAt: null } });
      await prisma.message.create({ data: { ...copy, body: "Quoted reply", direction: "out", externalKey: "x:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", replyToExternalKey: "x:preview:future-proof", createdAt: new Date(checkedAt + 60000) } });
      assert.equal(await reconcileXVerifiedSnapshot(prisma, account.id, "request-a", proof), 0, "quoted previews remain intact");
      await prisma.message.delete({ where: { externalKey: "x:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } });
      process.env.DATA_DIR = path.join(directory, "test.db");
      await assert.rejects(reconcileXVerifiedSnapshot(prisma, account.id, "request-a", proof));
      assert.ok(await prisma.message.findUnique({ where: { externalKey: "x:preview:future-proof" } }), "backup failure aborts deletion");
      process.env.DATA_DIR = directory;
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
    }
  } finally {
    await store?.prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
