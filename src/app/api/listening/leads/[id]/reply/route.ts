import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  postReply,
  replyFingerprint,
  REPLY_DAILY_CAP,
  REPLY_MIN_LENGTH,
  REPLY_MAX_LENGTH,
} from "@/lib/x-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = String(body.text ?? "").trim();
  const lead = await prisma.socialLead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (text.length < REPLY_MIN_LENGTH) {
    return NextResponse.json(
      { error: `Write at least ${REPLY_MIN_LENGTH} characters — a one-word reply reads as a bot.` },
      { status: 400 }
    );
  }
  if (text.length > REPLY_MAX_LENGTH) {
    return NextResponse.json({ error: `X caps replies at ${REPLY_MAX_LENGTH} characters.` }, { status: 400 });
  }
  if (lead.repliedAt) {
    return NextResponse.json({ error: "You already replied to this one." }, { status: 409 });
  }

  // Daily cap. The point is pacing: a burst of replies from one account to
  // strangers is the exact shape of automated spam, however human each one is.
  const usedToday = await prisma.socialLead.count({
    where: { repliedAt: { gte: startOfToday() } },
  });
  if (usedToday >= REPLY_DAILY_CAP) {
    return NextResponse.json(
      { error: `Daily cap reached (${REPLY_DAILY_CAP}). Raise X_REPLY_DAILY_CAP if you really mean to.` },
      { status: 429 }
    );
  }

  // Same text to many people is templating, which is what gets accounts flagged.
  const fingerprint = replyFingerprint(text);
  const recent = await prisma.socialLead.findMany({
    where: { repliedAt: { gte: new Date(Date.now() - 7 * 86400000) }, replyText: { not: null } },
    select: { replyText: true, username: true },
  });
  const clash = recent.find((r) => replyFingerprint(r.replyText || "") === fingerprint);
  if (clash) {
    return NextResponse.json(
      { error: `You sent almost exactly this to @${clash.username} in the last week. Write it fresh.` },
      { status: 409 }
    );
  }

  const result = await postReply(lead.postId, text);
  if (!result.ok) {
    console.error("[listening] reply failed:", result.error);
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }

  const updated = await prisma.socialLead.update({
    where: { id: lead.id },
    data: {
      repliedAt: new Date(),
      replyText: text,
      status: "contacted",
      contactedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    via: result.via,
    replyUrl: `https://x.com/i/status/${result.tweetId}`,
    lead: updated,
    remaining: Math.max(0, REPLY_DAILY_CAP - (usedToday + 1)),
  });
}
