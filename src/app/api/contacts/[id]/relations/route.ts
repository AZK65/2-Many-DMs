import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { RelationDTO } from "@/lib/types";
import type { Platform } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const withTarget = {
  targetConversation: { include: { contact: true } },
} as const;

type RelationRow = {
  id: string;
  label: string | null;
  targetConversationId: string;
  targetConversation: {
    platform: string;
    contact: { name: string; handle: string; avatarUrl: string | null };
  };
};

function toDTO(r: RelationRow): RelationDTO {
  return {
    id: r.id,
    label: r.label,
    conversationId: r.targetConversationId,
    contactName: r.targetConversation.contact.name,
    handle: r.targetConversation.contact.handle,
    avatarUrl: r.targetConversation.contact.avatarUrl,
    platform: r.targetConversation.platform as Platform,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const relations = await prisma.contactRelation.findMany({
    where: { contactId: params.id },
    include: withTarget,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(relations.map(toDTO));
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { targetConversationId, label } = await req.json();
  if (typeof targetConversationId !== "string" || !targetConversationId || (label !== undefined && typeof label !== "string") || (typeof label === "string" && label.length > 120)) {
    return NextResponse.json(
      { error: "targetConversationId required" },
      { status: 400 }
    );
  }

  const [contact, target] = await Promise.all([
    prisma.contact.findUnique({ where: { id: params.id }, select: { id: true, isGroup: true } }),
    prisma.conversation.findUnique({ where: { id: targetConversationId }, select: { id: true, contactId: true } }),
  ]);
  if (!contact || !target) return NextResponse.json({ error: "That contact or chat no longer exists." }, { status: 404 });
  if (contact.isGroup && target.contactId === contact.id) return NextResponse.json({ error: "Choose another chat to link." }, { status: 400 });

  const relation = await prisma.contactRelation.upsert({
    where: {
      contactId_targetConversationId: {
        contactId: params.id,
        targetConversationId,
      },
    },
    create: {
      contactId: params.id,
      targetConversationId,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
    },
    update:
      typeof label === "string" ? { label: label.trim() || null } : {},
    include: withTarget,
  });

  return NextResponse.json(toDTO(relation));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id, label } = await req.json();
  if (typeof id !== "string" || !id || (label !== undefined && typeof label !== "string") || (typeof label === "string" && label.length > 120)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const updated = await prisma.contactRelation.updateMany({
    where: { id, contactId: params.id },
    data: {
      label: typeof label === "string" && label.trim() ? label.trim() : null,
    },
  });
  if (!updated.count) return NextResponse.json({ error: "This link no longer exists for this contact." }, { status: 404 });
  const relation = await prisma.contactRelation.findFirst({ where: { id, contactId: params.id }, include: withTarget });
  if (!relation) return NextResponse.json({ error: "This link no longer exists." }, { status: 404 });
  return NextResponse.json(toDTO(relation));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await prisma.contactRelation.deleteMany({
    where: { id, contactId: params.id },
  });
  return NextResponse.json({ ok: true });
}
