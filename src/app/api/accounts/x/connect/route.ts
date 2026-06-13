import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { consumePairCode } from "@/lib/pairing";
import { assignProxy } from "@/lib/proxy-assign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The extension posts here cross-origin, so allow it (and answer preflight).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

// Receives the user's X session cookies from the browser extension, verified by
// the one-time pairing code, and stores them encrypted on an X Account.
export async function POST(req: NextRequest) {
  const { code, authToken, ct0 } = await req.json().catch(() => ({}));

  const userId = consumePairCode(String(code || ""));
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or expired pairing code. Get a fresh one in the app." },
      { status: 401, headers: CORS }
    );
  }
  if (!authToken || !ct0) {
    return NextResponse.json(
      { error: "Missing X session cookies." },
      { status: 400, headers: CORS }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json(
      { error: "Account not found." },
      { status: 404, headers: CORS }
    );
  }

  const proxy = await assignProxy(user).catch(() => null);
  const session = encrypt(JSON.stringify({ authToken, ct0 }));

  const account = await prisma.account.upsert({
    where: {
      userId_platform_label: {
        userId: user.id,
        platform: "x",
        label: "X account",
      },
    },
    create: {
      userId: user.id,
      platform: "x",
      label: "X account",
      status: "connected",
      session,
      proxyId: proxy?.id,
    },
    update: {
      status: "connected",
      session,
      proxyId: proxy?.id ?? undefined,
      detail: null,
    },
  });

  return NextResponse.json(
    { ok: true, accountId: account.id, proxyRegion: proxy?.region ?? null },
    { headers: CORS }
  );
}
