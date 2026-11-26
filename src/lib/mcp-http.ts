import { createMcpHandler } from "@modelcontextprotocol/server";
import type { PrismaClient } from "@prisma/client";
import {
  agentAccessStore,
  claimAgentRequest,
  mcpRequestAllowed,
} from "./mcp-access";
import { createChatMcpServer } from "./mcp-server";
import { mcpResource, oauthStore } from "./mcp-oauth";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function createAgentMcpEndpoint(
  prisma: PrismaClient,
  store = agentAccessStore(),
  oauth = oauthStore(),
) {
  return async function POST(request: Request) {
    if (!mcpRequestAllowed(request))
      return Response.json(
        { error: "Agent access is unavailable at this address." },
        { status: 403, headers },
      );
    try {
      const resource = mcpResource(request);
      const key =
        store.authenticate(request.headers.get("authorization")) ||
        oauth.authenticate(request.headers.get("authorization"), resource);
      if (!key)
        return Response.json(
          { error: "A valid agent access key is required." },
          {
            status: 401,
            headers: {
              ...headers,
              "WWW-Authenticate": `Bearer realm="2manydms", resource_metadata="${new URL(resource).origin}/.well-known/oauth-protected-resource/api/mcp", scope="chats:read"`,
            },
          },
        );
      const release = claimAgentRequest(key.id);
      if (!release)
        return Response.json(
          { error: "Too many requests. Try again shortly." },
          { status: 429, headers: { ...headers, "Retry-After": "60" } },
        );
      const handler = createMcpHandler(() => createChatMcpServer(prisma, key), {
        maxRequestBodySize: 16_384,
        maxSubscriptions: 0,
      });
      try {
        const response = await handler.fetch(request);
        // These tools produce bounded results and no subscription streams. Finish
        // the SDK response before releasing resources, including legacy SSE calls.
        const body = await response.arrayBuffer();
        const responseHeaders = new Headers(response.headers);
        Object.entries(headers).forEach(([name, value]) =>
          responseHeaders.set(name, value),
        );
        return new Response(body.byteLength ? body : null, {
          status: response.status,
          headers: responseHeaders,
        });
      } finally {
        try {
          await handler.close();
        } finally {
          release();
        }
      }
    } catch {
      return Response.json(
        { error: "Agent access is temporarily unavailable." },
        { status: 503, headers },
      );
    }
  };
}
