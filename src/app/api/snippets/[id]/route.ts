import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const data: { title?: string; text?: string; shortcut?: string | null } = {};
  if (typeof body.title === "string" && body.title.trim())
    data.title = body.title.trim();
  if (typeof body.text === "string") data.text = body.text;
  if (typeof body.shortcut === "string")
    data.shortcut = body.shortcut.trim()
      ? body.shortcut.trim().slice(0, 1).toLowerCase()
      : null;

  const snippet = await prisma.snippet.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(snippet);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.snippet.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
