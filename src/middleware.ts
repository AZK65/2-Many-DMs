import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public marketing deploy guard.
//
// When MARKETING_ONLY=1 (set on the public 2manydms.com Railway service), the
// app serves only the landing page. The landing is rendered
// at "/" (rewrite, so the address bar stays clean), "/landing" canonicalizes to
// "/", and every other route — the inbox, board, automations, onboarding, and
// all API routes — redirects to "/", so no conversation data is ever exposed and
// nobody can connect accounts on a public, unauthenticated instance. Leave the
// flag unset for a normal self-hosted/personal deploy and the whole app works.
async function validGuestCookie(value?: string): Promise<boolean> {
  const secret = process.env.SHARE_SESSION_SECRET || "";
  if (!value || !secret) return false;
  const [role, expiresRaw, supplied] = value.split(".");
  if (role !== "guest" || !expiresRaw || !supplied) return false;
  if (Number(expiresRaw) <= Date.now() / 1000) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${role}.${expiresRaw}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return supplied === expected;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(png|jpe?g|svg|ico|webp|gif|txt|xml|json|webmanifest|woff2?|css|js|map)$/.test(
      pathname
    );
  if (isAsset) return NextResponse.next();

  if (process.env.MARKETING_ONLY !== "1") {
    const host = (req.headers.get("host") || "").split(":")[0];
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (local) return NextResponse.next();

    const publicPath =
      pathname === "/invite" ||
      pathname === "/api/share/login" ||
      pathname === "/api/share/logout";
    if (publicPath) return NextResponse.next();

    // Machine-to-machine ingest from the social listening worker. It is a
    // server with no browser cookie, so the guest check below cannot apply.
    // POST only, single exact path, and the route itself verifies the
    // LISTENING_INGEST_SECRET bearer token before touching the database — if
    // that env var is unset the route rejects everything rather than opening.
    if (pathname === "/api/listening/ingest" && req.method === "POST") {
      return NextResponse.next();
    }

    const guest = await validGuestCookie(req.cookies.get("tmd_guest")?.value);
    if (!guest) {
      if (pathname.startsWith("/api/"))
        return NextResponse.json({ error: "Invite required" }, { status: 401 });
      const url = req.nextUrl.clone();
      url.pathname = "/invite";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // An invited guest can see only the purpose-built CRM directory. Inbox,
    // message, account, connection and automation data stay owner-only.
    if (pathname.startsWith("/api/")) {
      const guestApi =
        pathname === "/api/share/contacts" || pathname === "/api/share/logout";
      if (!guestApi)
        return NextResponse.json({ error: "Not available in CRM view" }, { status: 403 });
    } else if (pathname !== "/shared") {
      const url = req.nextUrl.clone();
      url.pathname = "/shared";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Guests are enforced read-only at the network boundary, not just in UI.
    if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method))
      return NextResponse.json({ error: "Read-only guest access" }, { status: 403 });

    const headers = new Headers(req.headers);
    headers.set("x-tmd-guest", "1");
    return NextResponse.next({ request: { headers } });
  }

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
