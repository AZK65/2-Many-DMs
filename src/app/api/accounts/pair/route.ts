import { NextRequest, NextResponse } from "next/server";
import { createPairCode } from "@/lib/pairing";
import { getCurrentUser, clientIp } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The onboarding screen calls this to get a short code the user types into the
// browser extension. The code maps back to their user for the cookie hand-off.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(clientIp(req));
  const code = createPairCode(user.id);
  return NextResponse.json({ code });
}
