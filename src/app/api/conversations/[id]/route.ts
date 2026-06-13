import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Update pin / hide / triage status / snooze on a conversation.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const data: {
    pinned?: boolean;
    hidden?: boolean;
    status?: string;
    snoozedUntil?: Date | null;
  } = {};
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.hidden === "boolean") data.hidden = body.hidden;
  if (
    body.status === "open" ||
    body.status === "waiting" ||
    body.status === "done"
  )
    data.status = body.status;
  if (body.snoozedUntil === null) data.snoozedUntil = null;
  else if (typeof body.snoozedUntil === "string")
    data.snoozedUntil = new Date(body.snoozedUntil);

  await prisma.conversation.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}
