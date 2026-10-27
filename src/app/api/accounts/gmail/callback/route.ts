import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getCurrentUser, clientIp } from "@/lib/currentUser";
import { gmailOAuthConfig } from "@/lib/gmail-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const base = process.env.WEB_URL || "http://localhost:3000";
  const requestedReturnTo = request.cookies.get("google_oauth_return_to")?.value || "/";
  const returnTo = requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : "/";
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    if (!code || !state || state !== request.cookies.get("gmail_oauth_state")?.value) throw new Error("Invalid Gmail authorization state");
    const { clientId, clientSecret, redirectUri } = gmailOAuthConfig();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) throw new Error(tokens.error_description || "Google did not return an offline refresh token");
    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.emailAddress) throw new Error("Could not read Gmail profile");
    const user = await getCurrentUser(clientIp(request));
    const session = encrypt(JSON.stringify({
      refreshToken: tokens.refresh_token,
      email: profile.emailAddress,
      scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [],
    }));
    const existing = await prisma.account.findFirst({ where: { userId: user.id, platform: "gmail", label: profile.emailAddress } });
    if (existing) await prisma.account.update({ where: { id: existing.id }, data: { session, status: "connected", driver: "api", detail: profile.emailAddress } });
    else await prisma.account.create({ data: { userId: user.id, platform: "gmail", label: profile.emailAddress, status: "connected", driver: "api", detail: profile.emailAddress, session } });
    await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/reload`, { method: "POST" }).catch(() => {});
    const separator = returnTo.includes("?") ? "&" : "?";
    const response = NextResponse.redirect(`${base}${returnTo}${separator}google=connected`);
    response.cookies.delete("gmail_oauth_state");
    response.cookies.delete("google_oauth_return_to");
    return response;
  } catch (error) {
    return NextResponse.redirect(`${base}${returnTo}${returnTo.includes("?") ? "&" : "?"}google_error=${encodeURIComponent(String(error))}`);
  }
}
