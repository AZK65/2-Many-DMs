import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { reloadConnections } from "@/lib/reload-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pendingCreates = new Map<string, Promise<{ id: string; platform: string; label: string | null; status: string; driver: string | null }>>();

function defaultDriver(platform: string): string | null {
  if (platform === "telegram") return "mtproto";
  if (platform === "whatsapp")
    return process.env.WHATSAPP_DRIVER === "baileys" ? "baileys" : "web";
  if (platform === "x") return process.env.X_DRIVER === "api" ? "api" : "browser";
  if (platform === "discord") return "bot";
  if (platform === "gmail") return "api";
  return null;
}

// Create a new (pending) account row. Telegram/X get their session from their
// own connect flows; WhatsApp links via QR once the worker starts this account.
export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const user = await getCurrentUser(clientIp(req));
  const { platform, label, reusePending } = (await setupBody(req)) as {
    platform?: string;
    label?: string;
    reusePending?: boolean;
  };
  if (!platform || !(platform in PLATFORMS)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  if (platform === "discord") {
    return NextResponse.json(
      {
        error:
          "Connect Discord with an official bot token from the Discord setup panel.",
      },
      { status: 400 }
    );
  }
  if (reusePending && platform === "whatsapp") {
    let pending = pendingCreates.get(user.id);
    if (!pending) {
      pending = (async () => {
        const existing = await prisma.account.findFirst({ where: { userId: user.id, platform, status: "pending" }, orderBy: { createdAt: "desc" } });
        if (existing) return existing;
        const accounts = await prisma.account.findMany({ where: { userId: user.id, platform }, select: { label: true } });
        const labels = new Set(accounts.map(account => account.label));
        let number = 1;
        while (labels.has(`WhatsApp ${number}`)) number++;
        return prisma.account.create({ data: { userId: user.id, platform, label: `WhatsApp ${number}`, status: "pending", driver: defaultDriver(platform) } });
      })();
      pendingCreates.set(user.id, pending);
    }
    try {
      const account = await pending;
      await reloadConnections();
      return NextResponse.json({ id: account.id, platform, label: account.label, status: account.status, driver: account.driver });
    } catch {
      return NextResponse.json({ error: "Could not prepare WhatsApp. Check the server connection and try again." }, { status: 503 });
    } finally { if (pendingCreates.get(user.id) === pending) pendingCreates.delete(user.id); }
  }
  const count = await prisma.account.count({
    where: { userId: user.id, platform },
  });
  const finalLabel =
    (typeof label === "string" && label.trim()) ||
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
  await reloadConnections();
  return NextResponse.json({
    id: account.id,
    platform: account.platform,
    label: account.label,
    status: account.status,
    driver: account.driver,
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
