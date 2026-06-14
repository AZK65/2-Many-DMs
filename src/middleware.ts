import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public marketing deploy guard.
//
// When MARKETING_ONLY=1 (set on the public 2manydms.com Railway service), the
// app serves ONLY the landing page. Every other route — the inbox, board,
// automations, onboarding, and all API routes — redirects to /landing, so no
// conversation data is ever exposed and nobody can connect accounts on a
// public, unauthenticated instance. Leave the flag unset for a normal
// self-hosted/personal deploy and the whole app works as usual.
export function middleware(req: NextRequest) {
  if (process.env.MARKETING_ONLY !== "1") return NextResponse.next();

  const { pathname } = req.nextUrl;
  const allowed =
    pathname === "/landing" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(png|jpe?g|svg|ico|webp|gif|txt|xml|woff2?|css|js|map)$/.test(pathname);

  if (allowed) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/landing";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next's static assets (those are always public).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
