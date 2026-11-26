import { oauthHttp } from "@/lib/mcp-oauth-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  { params }: { params: { action: string } },
) {
  return oauthHttp(request, params.action);
}
export const POST = GET;
