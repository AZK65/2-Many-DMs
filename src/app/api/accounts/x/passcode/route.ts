import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import type { XUnlockState } from "@/lib/x-unlock-state";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const { accountId, passcode } = await setupBody(req);
  if (typeof accountId !== "string" || typeof passcode !== "string" || !/^\d{4,32}$/.test(passcode)) {
    return NextResponse.json({ error: "Enter the numeric passcode you use to open X Chat. Do not enter your X password." }, { status: 400 });
  }
  try {
    const user = await getCurrentUser(clientIp(req));
    const account = await prisma.account.findFirst({ where: { id: accountId, userId: user.id, platform: "x" } });
    if (!account || account.driver === "api") return NextResponse.json({ error: "Select a saved X browser connection first." }, { status: 404 });
    // The running adapter owns the correct browser, including legacy accounts.
    // Never start a second session or confuse saving a code with verification.
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/x/unlock`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ accountId, passcode }), signal: AbortSignal.timeout(90_000),
    });
    const result = await response.json() as { unlock?: XUnlockState; error?: string };
    if (!response.ok || !result.unlock) return NextResponse.json({ error: result.error || "Start or update the sync worker, then try unlocking again." }, { status: response.ok ? 503 : response.status });
    return NextResponse.json({ unlock: result.unlock });
  } catch {
    return NextResponse.json({ error: "The unlock result could not be confirmed. Check the live status before trying again; the code was not saved to disk." }, { status: 503 });
  }
}
