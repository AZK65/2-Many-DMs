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
    inboxCategory?: string;
    inboxOverride?: boolean;
    status?: string;
    intent?: string;
    followUpAt?: Date | null;
    snoozedUntil?: Date | null;
    priority?: boolean;
    todo?: boolean;
    todoNote?: string | null;
    todoCompleted?: boolean;
    todoAddedAt?: Date | null;
  } = {};
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.hidden === "boolean") data.hidden = body.hidden;
  if (body.inboxCategory === "general" || body.inboxCategory === "spam")
    data.inboxCategory = body.inboxCategory;
  if (typeof body.inboxOverride === "boolean")
    data.inboxOverride = body.inboxOverride;
  if (
    body.status === "open" ||
    body.status === "waiting" ||
    body.status === "done"
  )
    data.status = body.status;
  if (["normal", "prospect", "onboarding", "support"].includes(body.intent))
    data.intent = body.intent;
  if (body.followUpAt === null) data.followUpAt = null;
  else if (typeof body.followUpAt === "string")
    data.followUpAt = new Date(body.followUpAt);
  if (body.snoozedUntil === null) data.snoozedUntil = null;
  else if (typeof body.snoozedUntil === "string")
    data.snoozedUntil = new Date(body.snoozedUntil);
  if (typeof body.priority === "boolean") data.priority = body.priority;
  if (typeof body.todo === "boolean") {
    data.todo = body.todo;
    data.todoAddedAt = body.todo ? new Date() : null;
    if (body.todo) data.todoCompleted = false;
  }
  if (body.todoNote === null || typeof body.todoNote === "string")
    data.todoNote = body.todoNote ? body.todoNote.trim().slice(0, 500) : null;
  if (typeof body.todoCompleted === "boolean")
    data.todoCompleted = body.todoCompleted;

  await prisma.conversation.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true });
}
