import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GMAIL_SCOPES, gmailOAuthConfig } from "@/lib/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { clientId, redirectUri } = gmailOAuthConfig();
    const state = crypto.randomBytes(24).toString("hex");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    response.cookies.set("gmail_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
    const requestedReturnTo = request.nextUrl.searchParams.get("returnTo") || "/";
    const returnTo = requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
      ? requestedReturnTo
      : "/";
    response.cookies.set("google_oauth_return_to", returnTo, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
    return response;
  } catch (error) {
    return NextResponse.redirect(`${process.env.WEB_URL || "http://localhost:3000"}/?gmail_error=${encodeURIComponent(String(error))}`);
  }
}
