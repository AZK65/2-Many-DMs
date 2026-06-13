import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The current user's connected platform accounts (never returns the session).
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(clientIp(req));
  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    include: { proxy: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(
    accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      label: a.label,
      status: a.status,
      detail: a.detail,
      proxyRegion: a.proxy?.region ?? null,
    }))
  );
}
