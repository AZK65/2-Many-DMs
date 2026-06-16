import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Rename / recolor a tag.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { name, color } = (await req.json().catch(() => ({}))) as {
    name?: string;
    color?: string;
  };
  const data: { name?: string; color?: string } = {};
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (typeof color === "string" && color.trim()) data.color = color.trim();
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const tag = await prisma.tag.update({ where: { id: params.id }, data });
  return NextResponse.json({ id: tag.id, name: tag.name, color: tag.color });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.tag.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
