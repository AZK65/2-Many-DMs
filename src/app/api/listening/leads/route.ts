import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The feed. Defaults to qualified leads only — REJECT rows are stored so you
 * can audit what the model threw away, but you have to ask for them.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tier = searchParams.get("tier"); // HOT | WARM | REJECT | all
  const status = searchParams.get("status"); // new | contacted | ignored | all
  const watcher = searchParams.get("watcher");
  const kind = searchParams.get("kind"); // lead | support
  const reason = searchParams.get("reason");
  const q = searchParams.get("q");
  const take = Math.min(Number(searchParams.get("limit") || 100), 500);

  const where: Prisma.SocialLeadWhereInput = {};
  const supportView = kind === "support";

  // The opportunity and support queues are separate workflows. Older callers
  // receive opportunities only so a support mention never leaks into lead
  // qualification views.
  where.kind = supportView ? "support" : { not: "support" };

  if (tier && tier !== "all") where.tier = tier.toUpperCase();
  else if (supportView || !tier) where.tier = { in: ["HOT", "WARM"] };

  if (status && status !== "all") where.status = status;
  if (watcher && watcher !== "all") where.watcher = watcher;
  if (reason) where.reason = reason;
  if (q) {
    where.OR = [
      { username: { contains: q } },
      { content: { contains: q } },
      { matchedQuery: { contains: q } },
    ];
  }

  const [leads, counts, support, supportNew, lastRun] = await Promise.all([
    prisma.socialLead.findMany({
      where,
      orderBy: [{ postedAt: "desc" }, { receivedAt: "desc" }],
      take,
    }),
    prisma.socialLead.groupBy({
      by: ["tier"],
      where: { kind: { not: "support" } },
      _count: { _all: true },
    }),
    prisma.socialLead.count({ where: { kind: "support", tier: { in: ["HOT", "WARM"] } } }),
    prisma.socialLead.count({ where: { kind: "support", tier: { in: ["HOT", "WARM"] }, status: "new" } }),
    prisma.socialRun.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const byTier: Record<string, number> = {};
  for (const c of counts) byTier[c.tier] = c._count._all;

  return NextResponse.json({
    leads,
    counts: {
      hot: byTier.HOT || 0,
      warm: byTier.WARM || 0,
      rejected: byTier.REJECT || 0,
      support,
      supportNew,
    },
    lastRun,
  });
}
