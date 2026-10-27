import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Platform } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export async function GET() {
  const contacts = await prisma.contact.findMany({
    orderBy: [{ stage: "asc" }, { name: "asc" }],
    include: {
      tags: { include: { tag: true } },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: { platform: true, lastMessageAt: true },
      },
    },
  });

  return NextResponse.json(
    contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      handle: contact.handle,
      avatarUrl: contact.avatarUrl,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      notes: contact.notes,
      stage: contact.stage,
      platform: (contact.conversations[0]?.platform || "telegram") as Platform,
      lastActivityAt:
        contact.conversations[0]?.lastMessageAt.toISOString() || null,
      tags: contact.tags.map(({ tag }) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
    }))
  );
}
