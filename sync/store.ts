import { PrismaClient } from "@prisma/client";
import type { InboundMessage } from "./adapters/types";

export const prisma = new PrismaClient();

// Clears the unread badge for a chat after it's been read on the platform
// (e.g. you opened it on your phone). Idempotent.
export async function persistRead(
  platform: string,
  chatExternalId: string
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { platform, externalId: chatExternalId },
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
    },
    update: {
      name: m.contact.name,
      handle: m.contact.handle,
      // Only overwrite the avatar when we actually fetched one.
      ...(m.contact.avatarUrl ? { avatarUrl: m.contact.avatarUrl } : {}),
    },
  });

  const conversation = await prisma.conversation.upsert({
    where: {
      platform_externalId: {
        platform: m.platform,
        externalId: m.chatExternalId,
      },
    },
    create: {
      platform: m.platform,
      externalId: m.chatExternalId,
      contactId: contact.id,
      lastMessageAt: m.timestamp,
    },
    update: {},
  });

  const existing = await prisma.message.findUnique({
    where: { externalKey: m.messageExternalId },
  });
  if (existing) {
    // Enrich a previously-synced row that predates media support.
    if (m.media && !existing.mediaType) {
      await prisma.message.update({
        where: { id: existing.id },
        data: {
          body: m.body,
          mediaType: m.media.type,
          mediaUrl: m.media.url,
          mediaName: m.media.name,
        },
      });
    }
    return;
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      body: m.body,
      direction: m.direction,
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
