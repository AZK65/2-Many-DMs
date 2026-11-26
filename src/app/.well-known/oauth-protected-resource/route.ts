import { oauthHttp } from "@/lib/mcp-oauth-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return oauthHttp(request, "resource");
}
