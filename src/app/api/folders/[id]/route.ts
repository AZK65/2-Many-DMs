import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Rename a folder (the inbox "tab").
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const f = await prisma.folder.update({
    where: { id: params.id },
    data: { name: name.trim() },
  });
  return NextResponse.json({ id: f.id, name: f.name });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.folder.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
