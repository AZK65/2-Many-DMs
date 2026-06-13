import { NextRequest, NextResponse } from "next/server";
import { verifyLogin } from "@/lib/telegram-login";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { assignProxy } from "@/lib/proxy-assign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2: verify the code (and 2FA password if asked), then store the encrypted
// session on an Account and pin a region-matched proxy.
export async function POST(req: NextRequest) {
  const { loginId, code, password } = await req.json();
  if (!loginId || !code) {
    return NextResponse.json({ error: "Enter the code." }, { status: 400 });
  }

  const result = await verifyLogin(
    String(loginId),
    String(code).trim(),
    password ? String(password) : undefined
  );

  if (result.status === "needs_password") {
    return NextResponse.json({ needsPassword: true });
  }
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  const ip = clientIp(req);
  const user = await getCurrentUser(ip);
  const proxy = await assignProxy(user).catch(() => null);

  const account = await prisma.account.upsert({
    where: {
      userId_platform_label: {
        userId: user.id,
        platform: "telegram",
        label: result.phone,
      },
    },
    create: {
      userId: user.id,
      platform: "telegram",
      label: result.phone,
      status: "connected",
      session: encrypt(result.session),
      proxyId: proxy?.id,
    },
    update: {
      status: "connected",
      session: encrypt(result.session),
      proxyId: proxy?.id ?? undefined,
      detail: null,
    },
  });

  return NextResponse.json({
    accountId: account.id,
    label: account.label,
    proxyRegion: proxy?.region ?? null,
  });
}
