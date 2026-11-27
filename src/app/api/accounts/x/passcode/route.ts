import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { isXChatPin, type XUnlockState } from "@/lib/x-unlock-state";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function pinSettings(req: NextRequest, action: "status" | "forget") {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  try {
    const accountId = req.nextUrl.searchParams.get("accountId");
    const user = await getCurrentUser(clientIp(req));
    const account = accountId && await prisma.account.findFirst({ where: { id: accountId, userId: user.id, platform: "x" } });
    if (!account || account.driver === "api") return NextResponse.json({ error: "Select a saved X browser connection first." }, { status: 404 });
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/x/pin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ accountId, action }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    const value = result.pinStorage;
    if (!response.ok || !value) throw new Error();
    return NextResponse.json({ pinStorage: { available: value.available === true, saved: value.saved === true, autoUnlock: value.autoUnlock === true, error: value.error } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Saved PIN settings are unavailable. Start sync and try again." }, { status: 503 }); }
}
export function GET(req: NextRequest) { return pinSettings(req, "status"); }
export function DELETE(req: NextRequest) { return pinSettings(req, "forget"); }
export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const { accountId, passcode, rememberPin } = await setupBody(req);
  if (typeof accountId !== "string" || !isXChatPin(passcode)) {
    return NextResponse.json({ error: "Enter your 4-digit X Chat PIN. This is the code you created in X Chat, not your account password or a login verification code." }, { status: 400 });
  }
  try {
    const user = await getCurrentUser(clientIp(req));
    const account = await prisma.account.findFirst({ where: { id: accountId, userId: user.id, platform: "x" } });
    if (!account || account.driver === "api") return NextResponse.json({ error: "Select a saved X browser connection first." }, { status: 404 });
    // The running adapter owns the correct browser, including legacy accounts.
    // Never start a second session or confuse saving a code with verification.
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/x/unlock`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ accountId, passcode, ...(typeof rememberPin === "boolean" ? { rememberPin } : {}) }), signal: AbortSignal.timeout(55_000),
    });
    const result = await response.json() as { unlock?: XUnlockState; error?: string; pinStorage?: { available: boolean; saved: boolean; autoUnlock: boolean; error?: string } };
    if (!response.ok || !result.unlock) return NextResponse.json({ error: result.error || "Start or update the sync worker, then try unlocking again." }, { status: response.ok ? 503 : response.status });
    return NextResponse.json({ unlock: result.unlock, pinStorage: result.pinStorage }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The unlock result could not be confirmed. Check the live status and saved PIN settings before trying again." }, { status: 503 });
  }
}
