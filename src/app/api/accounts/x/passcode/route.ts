import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { reloadConnections } from "@/lib/reload-connections";
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
    if (!account?.session) return NextResponse.json({ error: "Pair your X account first." }, { status: 404 });
    const session = JSON.parse(decrypt(account.session));
    if (!session.authToken || !session.ct0) return NextResponse.json({ error: "Reconnect this account with the browser extension first." }, { status: 400 });
    await prisma.account.update({ where: { id: accountId }, data: { session: encrypt(JSON.stringify({ ...session, passcode })), status: "pending" } });
    await reloadConnections();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save the passcode securely. Check the server and try again." }, { status: 503 });
  }
}
