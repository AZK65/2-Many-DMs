import { prisma } from "@/lib/db";
import { createAgentMcpEndpoint } from "@/lib/mcp-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAgentMcpEndpoint(prisma);
export function GET() {
  return Response.json(
    { error: "Use MCP Streamable HTTP POST requests." },
    {
      status: 405,
      headers: { "Cache-Control": "private, no-store", Allow: "POST" },
    },
  );
}
export const DELETE = GET;
