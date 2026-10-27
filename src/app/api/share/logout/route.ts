import { NextResponse } from "next/server";
import { SHARE_COOKIE } from "@/lib/share-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SHARE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
