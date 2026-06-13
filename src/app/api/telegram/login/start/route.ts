import { NextRequest, NextResponse } from "next/server";
import { startLogin } from "@/lib/telegram-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of phone login: send the code to the user's phone.
export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  const raw = typeof phone === "string" ? phone.trim() : "";
  if (!/^\+?\d[\d\s().-]{6,}$/.test(raw)) {
    return NextResponse.json(
      { error: "Enter your phone number with country code (e.g. +1…)." },
      { status: 400 }
    );
  }
  const normalized = raw.replace(/[\s().-]/g, "");
  try {
    const loginId = await startLogin(normalized);
    return NextResponse.json({ loginId });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    // Friendlier message for flood/rate limits.
    if (/FLOOD|too many/i.test(msg)) {
      return NextResponse.json(
        { error: "Too many attempts — wait a bit and try again." },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
