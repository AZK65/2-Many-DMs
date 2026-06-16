import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { PLATFORMS, type Platform } from "@/lib/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function defaultDriver(platform: string): string | null {
  if (platform === "telegram") return "mtproto";
  if (platform === "whatsapp")
    return process.env.WHATSAPP_DRIVER === "baileys" ? "baileys" : "web";
  if (platform === "x") return process.env.X_DRIVER === "api" ? "api" : "browser";
  return null;
}

// Create a new (pending) account row. Telegram/X get their session from their
// own connect flows; WhatsApp links via QR once the worker starts this account.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(clientIp(req));
  const { platform, label } = (await req.json().catch(() => ({}))) as {
    platform?: string;
    label?: string;
  };
  if (!platform || !(platform in PLATFORMS)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  const count = await prisma.account.count({
    where: { userId: user.id, platform },
  });
  const finalLabel =
    (label && label.trim()) ||
    `${PLATFORMS[platform as Platform].label} ${count + 1}`;
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      platform,
      label: finalLabel,
      status: "pending",
      driver: defaultDriver(platform),
    },
  });
  return NextResponse.json({
    id: account.id,
    platform: account.platform,
    label: account.label,
    status: account.status,
  });
}

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
      driver: a.driver,
      proxyRegion: a.proxy?.region ?? null,
    }))
  );
}
