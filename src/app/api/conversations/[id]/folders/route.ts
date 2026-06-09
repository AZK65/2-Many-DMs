import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { folderId } = await req.json();
  if (!folderId) {
    return NextResponse.json({ error: "folderId required" }, { status: 400 });
  }
  await prisma.conversationFolder.upsert({
    where: {
      conversationId_folderId: { conversationId: params.id, folderId },
    },
    create: { conversationId: params.id, folderId },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderId required" }, { status: 400 });
  }
  await prisma.conversationFolder.deleteMany({
    where: { conversationId: params.id, folderId },
  });
  return NextResponse.json({ ok: true });
}
