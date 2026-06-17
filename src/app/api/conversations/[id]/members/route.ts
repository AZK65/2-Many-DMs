import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Members of a group chat = the distinct people who've sent messages in it,
// with their tags. Tagging a member tags their shared Contact, so the tag shows
// on their messages everywhere (group + their 1:1).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rows = await prisma.message.findMany({
    where: { conversationId: params.id, senderContactId: { not: null } },
    distinct: ["senderContactId"],
    orderBy: { createdAt: "desc" },
    select: {
      senderContact: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          tags: { include: { tag: true } },
        },
      },
    },
  });
  const members = rows
    .map((r) => r.senderContact)
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      id: c.id,
      name: c.name,
      avatarUrl: c.avatarUrl,
      tags: c.tags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    }));
  return NextResponse.json(members);
}
