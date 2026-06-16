import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remove a connected account. Its conversations stay (accountId is set null by
// the optional relation) — they re-route to the platform's remaining account on
// the next worker start. Restart the worker to stop syncing this account.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(clientIp(req));
  await prisma.account.deleteMany({
    where: { id: params.id, userId: user.id },
  });
  return NextResponse.json({ ok: true });
}
