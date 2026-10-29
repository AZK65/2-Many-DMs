import { Prisma, type PrismaClient } from "@prisma/client";
import type { AvatarJob } from "./avatar-backfill";

/** Only platform IDs, never names or guessed phone numbers, identify a photo. */
export function avatarTarget(platform: string, externalKey: string | null): string | null {
  if (!externalKey?.startsWith(`${platform}:`)) return null;
  const id = externalKey.slice(platform.length + 1);
  if (platform === "telegram") return /^-?\d+(?:__t\d+)?$/.test(id) ? id : null;
  if (platform === "whatsapp") return /^[\d-]+@(lid|c\.us|s\.whatsapp\.net|g\.us)$/.test(id) ? id : null;
  if (platform === "x") return /^(?:user:|g)?\d+(?:-\d+)?$/.test(id) ? id : null;
  return null;
}

type Candidate = AvatarJob & { avatarUrl: string | null; lastSeen: number };

export async function collectAvatarJobs(db: PrismaClient, accountIds: string[]): Promise<AvatarJob[]> {
  if (!accountIds.length) return [];
  const conversations = await db.conversation.findMany({
    where: { accountId: { in: accountIds }, externalId: { not: null } },
    select: { accountId: true, platform: true, externalId: true, lastMessageAt: true,
      contact: { select: { id: true, externalKey: true, isGroup: true, avatarUrl: true } } },
  });
  const candidates: Candidate[] = conversations.flatMap(c => {
    if (!c.accountId || avatarTarget(c.platform, c.contact.externalKey) !== c.externalId) return [];
    return [{ accountId: c.accountId, contactId: c.contact.id, externalKey: c.contact.externalKey,
      chatId: c.externalId!, isGroup: c.contact.isGroup, platform: c.platform, attempts: 0,
      avatarUrl: c.contact.avatarUrl, lastSeen: c.lastMessageAt?.getTime() || 0 }];
  });
  // Group-only senders have no private Conversation. Select their newest exact
  // message per account; never cross accounts or scan by similar display name.
  const senders = await db.$queryRaw<Array<{
    accountId: string; platform: string; groupExternalId: string; messageKey: string | null;
    contactId: string; externalKey: string | null; avatarUrl: string | null; lastSeen: bigint;
  }>>(Prisma.sql`
    SELECT evidence.accountId, evidence.platform, evidence.groupExternalId, evidence.messageKey,
      person.id AS contactId, person.externalKey, person.avatarUrl, evidence.lastSeen
    FROM (
      SELECT chat.accountId, chat.platform, chat.externalId AS groupExternalId,
        message.externalKey AS messageKey, message.senderContactId, message.createdAt AS lastSeen,
        ROW_NUMBER() OVER (PARTITION BY chat.accountId, message.senderContactId
          ORDER BY message.createdAt DESC, message.id DESC) AS position
      FROM Message message JOIN Conversation chat ON chat.id = message.conversationId
      WHERE chat.accountId IN (${Prisma.join(accountIds)})
        AND message.senderContactId IS NOT NULL AND chat.externalId IS NOT NULL
    ) evidence JOIN Contact person ON person.id = evidence.senderContactId
    WHERE evidence.position = 1 AND person.isGroup = 0
  `);
  for (const sender of senders) {
    const target = avatarTarget(sender.platform, sender.externalKey);
    if (!target) continue;
    candidates.push({ accountId: sender.accountId, contactId: sender.contactId, externalKey: sender.externalKey,
      chatId: target, isGroup: false, platform: sender.platform, attempts: 0,
      groupExternalId: sender.groupExternalId, senderMessageExternalId: sender.messageKey || undefined,
      avatarUrl: sender.avatarUrl, lastSeen: Number(sender.lastSeen) });
  }
  candidates.sort((a, b) => Number(!!a.avatarUrl) - Number(!!b.avatarUrl) || b.lastSeen - a.lastSeen);
  const jobs = new Map<string, AvatarJob>();
  for (const { avatarUrl: _avatar, lastSeen: _seen, ...job } of candidates) {
    const key = `${job.accountId}:${job.contactId}`;
    const previous = jobs.get(key);
    if (!previous) jobs.set(key, job);
    else if (job.groupExternalId) Object.assign(previous, {
      groupExternalId: job.groupExternalId, senderMessageExternalId: job.senderMessageExternalId,
    });
  }
  return [...jobs.values()];
}

export function avatarContactWhere(job: AvatarJob): Prisma.ContactWhereInput {
  return { id: job.contactId, externalKey: job.externalKey, OR: [
    { conversations: { some: { accountId: job.accountId, platform: job.platform, externalId: job.chatId } } },
    ...(avatarTarget(job.platform, job.externalKey) === job.chatId && !job.isGroup
      ? [{ sentMessages: { some: { conversation: { accountId: job.accountId, platform: job.platform } } } }] : []),
  ] };
}
