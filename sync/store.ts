import { PrismaClient } from "@prisma/client";
import type { InboundMessage } from "./adapters/types";

export const prisma = new PrismaClient();

// Clears the unread badge for a chat after it's been read on the platform
// (e.g. you opened it on your phone). Idempotent.
export async function persistRead(
  accountId: string,
  chatExternalId: string
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { accountId, externalId: chatExternalId },
    data: { unread: 0 },
  });
}

// Writes an inbound (or echoed outbound) message into the same DB the UI reads.
// Idempotent: messages are deduped by their platform-unique externalKey, so
// re-running backfill or receiving our own echoed sends won't create duplicates.
export async function persistInbound(m: InboundMessage): Promise<void> {
  const contact = await prisma.contact.upsert({
    where: { externalKey: m.contact.externalKey },
    create: {
      name: m.contact.name,
      handle: m.contact.handle,
      externalKey: m.contact.externalKey,
      avatarUrl: m.contact.avatarUrl,
      isGroup: !!m.isGroup,
    },
    update: {
      name: m.contact.name,
      handle: m.contact.handle,
      ...(m.isGroup ? { isGroup: true } : {}),
      // Only overwrite the avatar when we actually fetched one.
      ...(m.contact.avatarUrl ? { avatarUrl: m.contact.avatarUrl } : {}),
    },
  });

  // For group messages, resolve the member who sent it (their externalKey
  // matches their 1:1 contact when one exists, so tags are shared).
  let senderContactId: string | undefined;
  if (m.sender) {
    const sc = await prisma.contact.upsert({
      where: { externalKey: m.sender.externalKey },
      create: {
        name: m.sender.name,
        handle: m.sender.name,
        externalKey: m.sender.externalKey,
        avatarUrl: m.sender.avatarUrl,
      },
      update: m.sender.avatarUrl ? { avatarUrl: m.sender.avatarUrl } : {},
    });
    senderContactId = sc.id;
  }

  // Routed per account so two of your own accounts can each hold a chat with
  // the same peer. accountId is injected by the worker per instance. (Prisma
  // can't upsert a compound unique with a nullable member, so find-then-create.)
  const accountId = m.accountId ?? null;
  let conversation = await prisma.conversation.findFirst({
    where: { accountId, externalId: m.chatExternalId },
  });
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: {
          platform: m.platform,
          accountId,
          externalId: m.chatExternalId,
          contactId: contact.id,
          lastMessageAt: m.timestamp,
        },
      });
    } catch {
      // Lost a race to a concurrent insert — the unique index held; re-read.
      conversation = await prisma.conversation.findFirst({
        where: { accountId, externalId: m.chatExternalId },
      });
    }
  }
  if (!conversation) throw new Error("could not resolve conversation");

  const existing = await prisma.message.findUnique({
    where: { externalKey: m.messageExternalId },
  });
  if (existing) {
    // Enrich a previously-synced row (media support, or group-sender backfill).
    const patch: Record<string, unknown> = {};
    if (m.media && !existing.mediaType) {
      patch.body = m.body;
      patch.mediaType = m.media.type;
      patch.mediaUrl = m.media.url;
      patch.mediaName = m.media.name;
    }
    if (senderContactId && !existing.senderContactId)
      patch.senderContactId = senderContactId;
    if (Object.keys(patch).length)
      await prisma.message.update({ where: { id: existing.id }, data: patch });
    return;
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      body: m.body,
      direction: m.direction,
      senderContactId,
      mediaType: m.media?.type,
      mediaUrl: m.media?.url ?? undefined,
      mediaName: m.media?.name,
      externalKey: m.messageExternalId,
      createdAt: m.timestamp,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: m.timestamp,
      unread: m.direction === "in" ? { increment: 1 } : undefined,
      // A new inbound message re-surfaces the chat: back to "open" (your turn)
      // and any snooze/done is cleared.
      ...(m.direction === "in"
        ? { status: "open", snoozedUntil: null }
        : {}),
    },
  });
}
