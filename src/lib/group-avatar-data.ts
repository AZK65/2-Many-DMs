import { prisma } from "./db";
import { buildGroupPreviews, type ObservedGroupMember } from "./group-avatars";
import type { GroupPreviewDTO } from "./types";

let cached: { expiresAt: number; value: Map<string, GroupPreviewDTO> } | undefined;
let pending: Promise<Map<string, GroupPreviewDTO>> | undefined;

// One local query for the entire inbox, never one network request per group.
// Inbound sender evidence excludes the user's own account and group contacts.
export async function groupPreviewMap() {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const rows = await prisma.$queryRaw<ObservedGroupMember[]>`
      SELECT m."conversationId", s."id", s."name", s."avatarUrl",
        MAX(m."createdAt") AS "lastSeen"
      FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
      JOIN "Contact" g ON g."id" = c."contactId" AND g."isGroup" = 1
      JOIN "Contact" s ON s."id" = m."senderContactId" AND s."isGroup" = 0
      WHERE m."direction" = 'in'
      GROUP BY m."conversationId", s."id"
    `;
    const value = buildGroupPreviews(rows);
    cached = { value, expiresAt: Date.now() + 30_000 };
    return value;
  })();
  try { return await pending; }
  finally { pending = undefined; }
}
