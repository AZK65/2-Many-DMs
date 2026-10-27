import { NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";

export const runtime = "nodejs";

async function updatePin(
  conversationId: string,
  messageId: string,
  pinnedAt: Date | null
) {
  await prismaReady;
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true },
  });
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { pinnedAt },
    select: { pinnedAt: true },
  });
  return NextResponse.json({
    ok: true,
    pinnedAt: updated.pinnedAt?.toISOString() ?? null,
  });
}

export async function PUT(
  _request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  return updatePin(params.id, params.messageId, new Date());
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  return updatePin(params.id, params.messageId, null);
}
