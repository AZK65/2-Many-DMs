import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MEDIA_LABEL, type ConversationDTO, type MediaType } from "@/lib/types";
import type { Platform } from "@/lib/platforms";

export async function GET() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: {
      contact: { include: { tags: { include: { tag: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      folders: { select: { folderId: true } },
    },
  });

  const data: ConversationDTO[] = conversations.map((c) => {
    const last = c.messages[0];
    const preview = last
      ? last.body ||
        (last.mediaType ? MEDIA_LABEL[last.mediaType as MediaType] : "")
      : null;
    return {
      id: c.id,
      platform: c.platform as Platform,
      unread: c.unread,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessage: preview,
      pinned: c.pinned,
      hidden: c.hidden,
      folderIds: c.folders.map((f) => f.folderId),
      contact: {
        id: c.contact.id,
        name: c.contact.name,
        handle: c.contact.handle,
        company: c.contact.company,
        notes: c.contact.notes,
        avatarUrl: c.contact.avatarUrl,
        tags: c.contact.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
      },
    };
  });

  return NextResponse.json(data);
}
