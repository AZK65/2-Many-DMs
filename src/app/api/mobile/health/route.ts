import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Native-client handshake used before an iPhone saves a private server. */
export async function GET(req: NextRequest) {
  await prismaReady;
  await prisma.$queryRaw`SELECT 1`;

  const login = req.headers.get("tailscale-user-login");
  const name = req.headers.get("tailscale-user-name");

  return NextResponse.json(
    {
      ok: true,
      service: "omni-crm",
      apiVersion: 1,
      serverTime: new Date().toISOString(),
      database: "ready",
      tailscaleUser: login || name ? { login, name } : null,
      capabilities: [
        "inbox",
        "messages",
        "attachments",
        "pipeline",
        "todos",
        "listening",
        "automations",
        "accounts",
      ],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
