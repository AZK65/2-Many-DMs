import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Linking controls are not cross-origin actions, including on localhost.
  const origin = req.headers.get("origin");
  let sameOrigin = !origin;
  try {
    // Next's internal URL can use localhost even when the browser uses
    // 127.0.0.1. Compare against the actual incoming Host header instead.
    sameOrigin = !origin || new URL(origin).host === req.headers.get("host");
  } catch { sameOrigin = false; }
  if (!sameOrigin) {
    return NextResponse.json({ error: "Open connection settings in Omni to refresh this code." }, { status: 403 });
  }
  const user = await getCurrentUser(clientIp(req));
  const account = await prisma.account.findFirst({
    where: { id: params.id, userId: user.id, platform: "whatsapp" },
    select: { id: true },
  });
  if (!account) return NextResponse.json({ error: "WhatsApp account not found." }, { status: 404 });
  try {
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/whatsapp/qr/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: account.id }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: "The WhatsApp connector did not answer. Check its status and try again." }, { status: 503 });
  }
}
