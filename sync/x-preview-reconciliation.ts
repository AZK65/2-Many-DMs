import type { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeXMessageText, xPreviewMatchesText } from "./x-message-text";

const nativeXKey = /^x:(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i;

export type VerifiedXSnapshot = { preview: string; direction: "in" | "out"; checkedAt: number };

// These checkpoints are written ONLY after a complete native history pass
// matches the latest inbox snapshot. A queued/failed/partial read is not proof.
export function verifiedXSnapshot(signature: string | undefined, checkedAt: number | undefined): VerifiedXSnapshot | undefined {
  const match = signature?.match(/^(in|out):([\s\S]+):(\d+)$/);
  if (!match || !checkedAt || !Number.isFinite(checkedAt)) return undefined;
  return { direction: match[1] as "in" | "out", preview: match[2], checkedAt };
}

export function xSnapshotProofs(previews: Iterable<[string, string]>, checked: Map<string, number>): Map<string, VerifiedXSnapshot> {
  const proofs = new Map<string, VerifiedXSnapshot>();
  for (const [key, signature] of previews) {
    if (!/^(?:general|spam):/.test(key)) continue;
    const proof = verifiedXSnapshot(signature, checked.get(key));
    const chatId = key.slice(key.indexOf(":") + 1);
    if (proof && proof.checkedAt > (proofs.get(chatId)?.checkedAt || 0)) proofs.set(chatId, proof);
  }
  return proofs;
}

// A successful latest-history checkpoint also covers a ONE-message request.
// Its preview clock can drift by hours/days, so a two-minute time join is not
// appropriate. Require one unique native anchor and an uninterrupted run of
// same-direction copies of that snapshot (including X's 200-character clip).
// Never infer across distinct messages/repeats or ambiguous full-body prefixes.
export async function reconcileXVerifiedSnapshot(db: PrismaClient, accountId: string, chatExternalId: string, proof: VerifiedXSnapshot): Promise<number> {
  const body = normalizeXMessageText(proof.preview);
  if (!body || !Number.isFinite(proof.checkedAt)) return 0;
  const conversation = await db.conversation.findFirst({ where: { accountId, platform: "x", externalId: chatExternalId }, select: { id: true } });
  if (!conversation) return 0;
  return db.$transaction(async tx => {
    const rows = await tx.message.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: {
      _count: { select: { reactions: true, emailCaptures: true, keywordAlertHits: true } },
    } });
    const same = (row: typeof rows[number]) => !row.mediaType && row.direction === proof.direction && normalizeXMessageText(row.body) === body;
    const natives = rows.filter(row => nativeXKey.test(row.externalKey || "") && !row.mediaType && row.direction === proof.direction && xPreviewMatchesText(proof.preview, row.body));
    if (natives.length !== 1 || natives[0].createdAt.getTime() > proof.checkedAt) return 0;
    const native = natives[0], anchor = rows.indexOf(native);
    const duplicates = [];
    for (const step of [-1, 1]) {
      for (let i = anchor + step; i >= 0 && i < rows.length; i += step) {
        const row = rows[i];
        if (!row.externalKey?.startsWith("x:preview:") || row.id.startsWith("client_") || !same(row)) break;
        // Observations newer than the successful read remain provisional.
        if (row.createdAt.getTime() > proof.checkedAt) continue;
        if (row.pinnedAt || row.originalBody || row.translatedBody || Object.values(row._count).some(Boolean)) continue;
        if (await tx.message.count({ where: { replyToExternalKey: row.externalKey } })) continue;
        duplicates.push({ preview: row, nativeId: native.id });
      }
    }
    if (!duplicates.length) return 0;
    saveRecoveryCopy(conversation.id, duplicates);
    return (await tx.message.deleteMany({ where: { id: { in: duplicates.map(item => item.preview.id) } } })).count;
  });
}

// Apply the same repair to every saved chat, including idle requests that may
// never be opened again. This is local DB work; it does not poll/navigate X.
export async function reconcileXAccountPreviews(db: PrismaClient, accountId: string, proofs: Map<string, VerifiedXSnapshot>): Promise<{ scanned: number; changed: number; removed: number }> {
  const chats = await db.conversation.findMany({ where: { platform: "x", accountId, externalId: { not: null }, messages: { some: { externalKey: { startsWith: "x:preview:" } } } }, select: { externalId: true } });
  let changed = 0, removed = 0;
  for (const chat of chats) {
    const proof = proofs.get(chat.externalId!);
    const count = await coalesceXPreviewRuns(db, accountId, chat.externalId!) + (proof ? await reconcileXVerifiedSnapshot(db, accountId, chat.externalId!, proof) : 0);
    if (count) { changed++; removed += count; }
  }
  return { scanned: chats.length, changed, removed };
}

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
    let allNativeRows: Array<Pick<typeof rows[number], "externalKey" | "body" | "direction" | "mediaType">> | undefined;
    let firstCopy = true;
    const duplicates = [];
    for (const row of rows) {
      if (nativeXKey.test(row.externalKey || "") && !row.mediaType && row.body.trim()) { anchor = row; firstCopy = true; continue; }
      const generated = row.externalKey?.startsWith("x:preview:") && !row.id.startsWith("client_");
      const delta = anchor ? row.createdAt.getTime() - anchor.createdAt.getTime() : Infinity;
      if (!anchor || !generated || row.mediaType || row.direction !== anchor.direction || !xPreviewMatchesText(row.body, anchor.body) || delta < 0 || delta > (firstCopy ? 130000 : 3600000)) {
        anchor = undefined; continue;
      }
      if (normalizeXMessageText(row.body) !== normalizeXMessageText(anchor.body)) {
        // A clipped prefix may belong to multiple genuine messages, even
        // outside the bounded run above. Do not guess which one it represents.
        allNativeRows ??= (await tx.message.findMany({ where: { conversationId: conversation.id }, select: {
          externalKey: true, body: true, direction: true, mediaType: true,
        } })).filter(candidate => nativeXKey.test(candidate.externalKey || ""));
        if (allNativeRows.filter(candidate => !candidate.mediaType && candidate.direction === row.direction && xPreviewMatchesText(row.body, candidate.body)).length !== 1) {
          anchor = undefined; continue;
        }
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
      const matches = natives.filter(native => !native.mediaType && native.direction === preview.direction && xPreviewMatchesText(preview.body, native.body));
      if (matches.length !== 1 || !preview.body.trim()) continue;
      const native = matches[0];
      if (normalizeXMessageText(preview.body) !== normalizeXMessageText(native.body)) {
        const candidates = await tx.message.findMany({ where: { conversationId: conversation.id, direction: preview.direction, mediaType: null }, select: { externalKey: true, body: true } });
        if (candidates.filter(row => nativeXKey.test(row.externalKey || "") && xPreviewMatchesText(preview.body, row.body)).length !== 1) continue;
      }
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
