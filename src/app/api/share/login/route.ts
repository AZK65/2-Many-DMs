import { NextRequest, NextResponse } from "next/server";
import {
  createGuestSession,
  SHARE_COOKIE,
  SHARE_MAX_AGE,
} from "@/lib/share-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({}));
  const expected = process.env.SHARE_INVITE_CODE || "";
  if (!expected || String(code || "").trim() !== expected) {
    return NextResponse.json({ error: "Invalid invite code." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SHARE_COOKIE, createGuestSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SHARE_MAX_AGE,
  });
  return res;
}
