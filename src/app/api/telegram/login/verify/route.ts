import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { verifyLogin, cancelLogin } from "@/lib/telegram-login";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { reloadConnections } from "@/lib/reload-connections";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const { loginId, code, password } = await setupBody(req);
  if (typeof loginId !== "string" || typeof code !== "string" || !/^\d{4,8}$/.test(code.trim()) || (password != null && typeof password !== "string")) {
    return NextResponse.json({ error: "Enter the login code from Telegram." }, { status: 400 });
  }
  try {
    const user = await getCurrentUser(clientIp(req));
    const result = await verifyLogin(user.id, loginId, code.trim(), password ?? undefined);
    if (result.status === "needs_password") return NextResponse.json({ needsPassword: true });
    if (result.status === "error") return NextResponse.json(result, { status: result.retryAfter ? 429 : 400 });
    const session = encrypt(result.session);
    const account = await prisma.account.upsert({
      where: { userId_platform_label: { userId: user.id, platform: "telegram", label: result.phone } },
      create: { userId: user.id, platform: "telegram", label: result.phone, status: "pending", driver: "mtproto", session },
      update: { status: "pending", driver: "mtproto", session, detail: null },
    });
    await cancelLogin(loginId, user.id);
    const workerReloaded = await reloadConnections();
    return NextResponse.json({ accountId: account.id, label: account.label, workerReloaded });
  } catch {
    return NextResponse.json({ error: "Could not save your connection. Try Verify again; you do not need another code." }, { status: 503 });
  }
}
