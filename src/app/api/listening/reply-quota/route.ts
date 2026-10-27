import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionReady, replyPathReady, REPLY_DAILY_CAP } from "@/lib/x-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many replies are left today, and whether the X session is usable. */
export async function GET() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const usedToday = await prisma.socialLead.count({
    where: { repliedAt: { gte: start } },
  });

  const path = await replyPathReady();

  return NextResponse.json({
    sessionReady: sessionReady(),
    replyPathReady: path.ok,
    queryId: path.queryId ?? null,
    cap: REPLY_DAILY_CAP,
    usedToday,
    remaining: Math.max(0, REPLY_DAILY_CAP - usedToday),
  });
}
