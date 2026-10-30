import type { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeXMessageText } from "./x-message-text";

const nativeXKey = /^x:(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i;

// A run of generated inbox copies is not a run of native messages. The first
// copy must closely match a saved native anchor; every following row must be
// the same generated preview. Stop at ANY distinct/native message. This also
// handles accepted requests whose pre-acceptance history X no longer exposes.
export async function coalesceXPreviewRuns(db: PrismaClient, accountId: string, chatExternalId: string): Promise<number> {
  const conversation = await db.conversation.findFirst({ where: { accountId, platform: "x", externalId: chatExternalId }, select: { id: true } });
  if (!conversation) return 0;
  return db.$transaction(async tx => {
    // Bound work on large histories; a missing anchor at the edge is left alone.
    const rows = (await tx.message.findMany({ where: { conversationId: conversation.id }, take: 2000, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: {
      _count: { select: { reactions: true, emailCaptures: true, keywordAlertHits: true } },
    } })).reverse();
    let anchor: typeof rows[number] | undefined;
    let firstCopy = true;
    const duplicates = [];
    for (const row of rows) {
      if (nativeXKey.test(row.externalKey || "") && !row.mediaType && row.body.trim()) { anchor = row; firstCopy = true; continue; }
      const generated = row.externalKey?.startsWith("x:preview:") && !row.id.startsWith("client_");
      const delta = anchor ? row.createdAt.getTime() - anchor.createdAt.getTime() : Infinity;
      if (!anchor || !generated || row.mediaType || row.direction !== anchor.direction || normalizeXMessageText(row.body) !== normalizeXMessageText(anchor.body) || delta < 0 || delta > (firstCopy ? 130000 : 3600000)) {
        anchor = undefined; continue;
      }
      firstCopy = false;
      if (row.pinnedAt || row.originalBody || row.translatedBody || Object.values(row._count).some(Boolean)) continue;
      if (await tx.message.count({ where: { replyToExternalKey: row.externalKey } })) continue;
      duplicates.push({ preview: row, nativeId: anchor.id });
    }
    if (!duplicates.length) return 0;
    saveRecoveryCopy(conversation.id, duplicates);
    return (await tx.message.deleteMany({ where: { id: { in: duplicates.map(item => item.preview.id) } } })).count;
  });
}

function saveRecoveryCopy(conversationId: string, duplicates: unknown[]) {
  const directory = path.join(process.env.DATA_DIR || process.cwd(), ".x_preview_backups");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ conversationId, duplicates }, null, 2), { mode: 0o600, flag: "wx" });
}

// Only reconcile against IDs actually read in this pass. Never remove native
// messages, infer a missing message from a preview, or collapse genuine repeats.
export async function reconcileXPreviewCopies(db: PrismaClient, accountId: string, chatExternalId: string, nativeKeys: string[], coverage?: { since: number; until: number }): Promise<number> {
  const keys = nativeKeys.filter(key => /^x:(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i.test(key));
  if (!keys.length) return 0;
  const conversation = await db.conversation.findFirst({ where: { accountId, platform: "x", externalId: chatExternalId }, select: { id: true } });
  if (!conversation) return 0;
  return db.$transaction(async tx => {
    const natives = await tx.message.findMany({ where: { conversationId: conversation.id, externalKey: { in: keys } } });
    if (!natives.length) return 0;
    const previews = await tx.message.findMany({ where: {
      conversationId: conversation.id, externalKey: { startsWith: "x:preview:" }, id: { not: { startsWith: "client_" } },
      mediaType: null, pinnedAt: null, originalBody: null, translatedBody: null,
      reactions: { none: {} }, emailCaptures: { none: {} }, keywordAlertHits: { none: {} },
      createdAt: { gte: new Date(Math.min(...natives.map(m => m.createdAt.getTime())) - 130000), lte: new Date(Math.max(...natives.map(m => m.createdAt.getTime())) + 130000) },
    } });
    const duplicates = [];
    for (const preview of previews) {
      const matches = natives.filter(native => !native.mediaType && native.direction === preview.direction && normalizeXMessageText(native.body) === normalizeXMessageText(preview.body));
      if (matches.length !== 1 || !preview.body.trim()) continue;
      const native = matches[0];
      const drift = preview.createdAt.getTime() - native.createdAt.getTime();
      // A complete, freshly read interval can prove that a request preview's
      // rounded clock drifted. Never widen fuzzy matching over unread history,
      // intervening native messages, genuine repeats, or outside that interval.
      const verifiedDrift = coverage && drift >= 0 && drift <= 60 * 60_000 &&
        native.createdAt.getTime() >= coverage.since && preview.createdAt.getTime() <= coverage.until &&
        !natives.some(row => row.id !== native.id && row.createdAt > native.createdAt && row.createdAt <= preview.createdAt);
      if (Math.abs(drift) > 130000 && !verifiedDrift) continue;
      if (await tx.message.count({ where: { replyToExternalKey: preview.externalKey } })) continue;
      duplicates.push({ preview, nativeId: matches[0].id });
    }
    if (!duplicates.length) return 0;
    // Retain a private recovery copy before removing generated, unannotated
    // duplicates. A backup failure aborts the transaction without deleting data.
    saveRecoveryCopy(conversation.id, duplicates);
    const result = await tx.message.deleteMany({ where: { id: { in: duplicates.map(item => item.preview.id) } } });
    return result.count;
  });
}
