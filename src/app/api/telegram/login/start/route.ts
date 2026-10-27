import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { startLogin, cancelLogin } from "@/lib/telegram-login";
import { normalizeTelegramPhone, telegramCredentials } from "@/lib/connection-setup";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { encrypt } from "@/lib/crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let storageReady = true;
  try { encrypt("setup-check"); } catch { storageReady = false; }
  return NextResponse.json({ configured: !!telegramCredentials(process.env.TELEGRAM_API_ID, process.env.TELEGRAM_API_HASH), storageReady });
}
export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const body = await setupBody(req);
  const phone = normalizeTelegramPhone(body.phone);
  if (!phone) return NextResponse.json({ error: "Enter your phone number with its country code, starting with +." }, { status: 400 });
  const credentials = telegramCredentials(body.apiId ?? process.env.TELEGRAM_API_ID, body.apiHash ?? process.env.TELEGRAM_API_HASH);
  if (!credentials) return NextResponse.json({ error: "Add a numeric API ID and the 32 character API hash from Telegram first.", action: "credentials" }, { status: 400 });
  try { encrypt("setup-check"); } catch {
    return NextResponse.json({ error: "Secure storage is not configured. Ask the server owner to set APP_ENCRYPTION_KEY before connecting accounts." }, { status: 503 });
  }
  try {
    const user = await getCurrentUser(clientIp(req));
    const result = await startLogin(user.id, phone, credentials);
    return NextResponse.json(result, { status: "error" in result ? (result.retryAfter ? 429 : 400) : 200 });
  } catch {
    return NextResponse.json({ error: "Could not start sign in. Check that the server and database are available, then try again." }, { status: 503 });
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open setup from your app to continue." }, { status: 403 });
  const { loginId } = await setupBody(req);
  const user = await getCurrentUser(clientIp(req));
  if (typeof loginId === "string") await cancelLogin(loginId, user.id);
  return NextResponse.json({ ok: true });
}
