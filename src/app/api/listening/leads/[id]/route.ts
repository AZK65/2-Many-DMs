import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { relayFeedbackToListener } from "@/lib/listening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["new", "contacted", "ignored"];
const RATINGS = ["good", "bad"];

/** Update workflow state on a lead: status, 👍/👎, or a note. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lead = await prisma.socialLead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  if (typeof body.status === "string") {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }
    data.status = body.status;
    data.contactedAt = body.status === "contacted" ? new Date() : null;
  }

  if (body.rating !== undefined) {
    if (body.rating !== null && !RATINGS.includes(body.rating)) {
      return NextResponse.json({ error: `rating must be good, bad, or null` }, { status: 400 });
    }
    data.rating = body.rating;
  }

  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 2000);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.socialLead.update({ where: { id: params.id }, data });

  // Teach the listener's few-shot examples. Best-effort — the rating is already
  // saved, so a listener outage must not fail the request.
  let relay = null;
  if (typeof body.rating === "string") {
    relay = await relayFeedbackToListener({
      postId: updated.postId,
      username: updated.username,
      content: updated.content,
      watcher: updated.watcher,
      rating: body.rating,
    });
  }

  return NextResponse.json({ lead: updated, relay });
}

/** Erase a single lead. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.socialLead.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
