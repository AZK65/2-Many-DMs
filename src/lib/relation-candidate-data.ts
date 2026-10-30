import { prisma } from "./db";
import type { RelationChat, RelationMember } from "./relation-candidates";
import type { Platform } from "./platforms";

let cache: { until: number; chats: RelationChat[]; members: RelationMember[] } | undefined;
let pending: Promise<{ chats: RelationChat[]; members: RelationMember[] }> | undefined;

// Only saved inbound speakers count as observed members. Never fetch platform
// rosters, infer a person's identity from their name, or create conversations.
export async function relationCandidateData() {
  if (cache && cache.until > Date.now()) return cache;
  if (pending) return pending;
  pending = (async () => {
    const [chats, members] = await Promise.all([
      prisma.conversation.findMany({ select: {
        id: true, contactId: true, platform: true, externalId: true, archived: true, hidden: true, lastMessageAt: true,
        account: { select: { label: true } },
        contact: { select: { name: true, handle: true, avatarUrl: true, isGroup: true, email: true, phone: true, company: true } },
      } }),
      prisma.$queryRaw<RelationMember[]>`
        SELECT m."conversationId", s."id", s."name", s."handle", s."email", s."phone", s."avatarUrl"
        FROM "Message" m
        JOIN "Conversation" c ON c."id" = m."conversationId"
        JOIN "Contact" g ON g."id" = c."contactId" AND g."isGroup" = 1
        JOIN "Contact" s ON s."id" = m."senderContactId" AND s."isGroup" = 0
        WHERE m."direction" = 'in'
        GROUP BY m."conversationId", s."id"
      `,
    ]);
    const value = { members, chats: chats.map(chat => ({
      ...chat.contact, id: chat.id, contactId: chat.contactId, platform: chat.platform as Platform,
      externalId: chat.externalId, archived: chat.archived, hidden: chat.hidden,
      accountLabel: chat.account?.label || null, lastMessageAt: chat.lastMessageAt.toISOString(),
    })) };
    cache = { ...value, until: Date.now() + 30_000 };
    return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}
