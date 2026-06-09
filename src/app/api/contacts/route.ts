import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MEDIA_LABEL, type ContactCardDTO, type MediaType } from "@/lib/types";
import type { Platform } from "@/lib/platforms";

export const dynamic = "force-dynamic";

// Distinct contacts (deals) for the Kanban board, each with their tags and a
// pointer back to their most-recent conversation.
export async function GET() {
  const contacts = await prisma.contact.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      tags: { include: { tag: true } },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });

  const data: ContactCardDTO[] = contacts.map((c) => {
    const conv = c.conversations[0];
    const last = conv?.messages[0];
    const preview = last
      ? last.body ||
        (last.mediaType ? MEDIA_LABEL[last.mediaType as MediaType] : "")
      : null;
    return {
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatarUrl: c.avatarUrl,
      platform: (conv?.platform ?? "telegram") as Platform,
      conversationId: conv?.id ?? null,
      lastMessage: preview,
      lastMessageAt: conv?.lastMessageAt.toISOString() ?? null,
      tags: c.tags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    };
  });

  return NextResponse.json(data);
}
