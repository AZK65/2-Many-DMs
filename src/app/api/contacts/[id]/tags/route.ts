import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { tagId } = await req.json();
  if (!tagId) {
    return NextResponse.json({ error: "tagId required" }, { status: 400 });
  }

  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId: params.id, tagId } },
    create: { contactId: params.id, tagId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tagId = req.nextUrl.searchParams.get("tagId");
  if (!tagId) {
    return NextResponse.json({ error: "tagId required" }, { status: 400 });
  }

  await prisma.contactTag.deleteMany({
    where: { contactId: params.id, tagId },
  });

  return NextResponse.json({ ok: true });
}
