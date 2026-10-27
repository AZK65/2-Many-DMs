import { sameSetupOrigin } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { createPairCode, pairStatus } from "@/lib/pairing";
import { getCurrentUser, clientIp } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The onboarding screen calls this to get a short code the user types into the
// browser extension. The code maps back to their user for the cookie hand-off.
export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const user = await getCurrentUser(clientIp(req));
  const code = createPairCode(user.id);
  return NextResponse.json({ code, expiresAt: pairStatus(code, user.id)!.expires });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(clientIp(req));
  const pair = pairStatus(req.nextUrl.searchParams.get("code") || "", user.id);
  return NextResponse.json(pair ? { expiresAt: pair.expires, accountId: pair.accountId || null } : { expired: true });
}
