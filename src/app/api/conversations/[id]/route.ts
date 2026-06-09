import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Toggle pin / hide on a conversation.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const data: { pinned?: boolean; hidden?: boolean } = {};
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.hidden === "boolean") data.hidden = body.hidden;

  await prisma.conversation.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}
