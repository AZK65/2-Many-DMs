import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public marketing deploy guard.
//
// When MARKETING_ONLY=1 (set on the public 2manydms.com Railway service), the
// app serves ONLY the landing page — at the root URL. The landing is rendered
// at "/" (rewrite, so the address bar stays clean), "/landing" canonicalizes to
// "/", and every other route — the inbox, board, automations, onboarding, and
// all API routes — redirects to "/", so no conversation data is ever exposed and
// nobody can connect accounts on a public, unauthenticated instance. Leave the
// flag unset for a normal self-hosted/personal deploy and the whole app works.
export function middleware(req: NextRequest) {
  if (process.env.MARKETING_ONLY !== "1") return NextResponse.next();

  const { pathname } = req.nextUrl;

  const isAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(png|jpe?g|svg|ico|webp|gif|txt|xml|json|woff2?|css|js|map)$/.test(pathname);
  if (isAsset) return NextResponse.next();

  // The public changelog page is part of the marketing site.
  if (pathname === "/changelog") return NextResponse.next();

  // Serve the landing page at the root URL without a visible /landing path.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/landing";
    return NextResponse.rewrite(url);
  }

  // Everything else (including /landing itself) canonicalizes to "/".
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next's static assets (those are always public).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
