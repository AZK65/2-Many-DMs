import type { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeXMessageText } from "./x-message-text";

// Only reconcile against IDs actually read in this pass. Never remove native
// messages, infer a missing message from a preview, or collapse genuine repeats.
export async function reconcileXPreviewCopies(db: PrismaClient, accountId: string, chatExternalId: string, nativeKeys: string[]): Promise<number> {
  const keys = nativeKeys.filter(key => /^x:(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i.test(key));
  if (!keys.length) return 0;
  const conversation = await db.conversation.findFirst({ where: { accountId, platform: "x", externalId: chatExternalId }, select: { id: true } });
  if (!conversation) return 0;
  return db.$transaction(async tx => {
    const natives = await tx.message.findMany({ where: { conversationId: conversation.id, externalKey: { in: keys }, mediaType: null } });
    if (!natives.length) return 0;
    const previews = await tx.message.findMany({ where: {
      conversationId: conversation.id, externalKey: { startsWith: "x:preview:" }, id: { not: { startsWith: "client_" } },
      mediaType: null, pinnedAt: null, originalBody: null, translatedBody: null,
      reactions: { none: {} }, emailCaptures: { none: {} }, keywordAlertHits: { none: {} },
      createdAt: { gte: new Date(Math.min(...natives.map(m => m.createdAt.getTime())) - 130000), lte: new Date(Math.max(...natives.map(m => m.createdAt.getTime())) + 130000) },
    } });
    const duplicates = [];
    for (const preview of previews) {
      const matches = natives.filter(native => native.direction === preview.direction && normalizeXMessageText(native.body) === normalizeXMessageText(preview.body) && Math.abs(native.createdAt.getTime() - preview.createdAt.getTime()) <= 130000);
      if (matches.length !== 1 || !preview.body.trim()) continue;
      if (await tx.message.count({ where: { replyToExternalKey: preview.externalKey } })) continue;
      duplicates.push({ preview, nativeId: matches[0].id });
    }
    if (!duplicates.length) return 0;
    // Retain a private recovery copy before removing generated, unannotated
    // duplicates. A backup failure aborts the transaction without deleting data.
    const directory = path.join(process.env.DATA_DIR || process.cwd(), ".x_preview_backups");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ conversationId: conversation.id, duplicates }, null, 2), { mode: 0o600, flag: "wx" });
    const result = await tx.message.deleteMany({ where: { id: { in: duplicates.map(item => item.preview.id) } } });
    return result.count;
  });
}
