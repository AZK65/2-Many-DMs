import { z } from "zod";
import { claimAgentRequest, mcpRequestAllowed } from "./mcp-access";
import { mcpResource, OAuthError, oauthStore } from "./mcp-oauth";

const headers = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
export async function oauthHttp(request: Request, action: string) {
  if (!mcpRequestAllowed(request))
    return Response.json({ error: "access_denied" }, { status: 403, headers });
  const release = claimAgentRequest(`oauth:${action}`);
  if (!release)
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 429, headers: { ...headers, "Retry-After": "60" } },
    );
  try {
    const resource = mcpResource(request);
    const issuer = new URL(resource).origin;
    if (request.method === "GET" && action === "resource")
      return Response.json(
        {
          resource,
          authorization_servers: [issuer],
          scopes_supported: ["chats:read"],
          bearer_methods_supported: ["header"],
        },
        { headers },
      );
    if (request.method === "GET" && action === "metadata")
      return Response.json(
        {
          issuer,
          authorization_endpoint: `${issuer}/mcp/authorize`,
          token_endpoint: `${issuer}/api/mcp/oauth/token`,
          registration_endpoint: `${issuer}/api/mcp/oauth/register`,
          revocation_endpoint: `${issuer}/api/mcp/oauth/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["chats:read"],
        },
        { headers },
      );
    const store = oauthStore();
    if (request.method === "GET" && action === "authorize")
      return Response.json(
        store.describe(
          Object.fromEntries(new URL(request.url).searchParams),
          resource,
        ),
        { headers },
      );
    if (request.method !== "POST")
      return Response.json(
        { error: "invalid_request" },
        { status: 405, headers },
      );
    const reader = request.body?.getReader();
    let body = "";
    let bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 16_384) {
            await reader.cancel();
            throw new OAuthError("invalid_request", "Request too large.", 413);
          }
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    const json =
      request.headers.get("content-type")?.split(";")[0].trim() ===
      "application/json";
    if (action === "register") {
      if (!json)
        throw new OAuthError("invalid_request", "Use application/json.");
      return Response.json(store.register(JSON.parse(body)), {
        status: 201,
        headers,
      });
    }
    if (action === "approve") {
      const origin = request.headers.get("origin");
      if (
        !json ||
        origin !== issuer ||
        request.headers.get("x-tmd-oauth-consent") !== "1"
      )
        throw new OAuthError(
          "access_denied",
          "Approve access on this server's authorization screen.",
          403,
        );
      const input = z
        .object({
          request: z.record(z.string(), z.string().max(2048)),
          key: z.string().max(100),
        })
        .parse(JSON.parse(body));
      return Response.json(store.approve(input.request, input.key, resource), {
        headers,
      });
    }
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new OAuthError("invalid_request", "Use form-encoded parameters.");
    const params = new URLSearchParams(body);
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      throw new OAuthError(
        "invalid_request",
        "Duplicate parameters are not accepted.",
      );
    const input = Object.fromEntries(params);
    if (action === "token")
      return Response.json(store.exchange(input, resource), { headers });
    if (action === "revoke") {
      store.revoke(input.token || "", input.client_id || "");
      return new Response(null, { status: 200, headers });
    }
    return Response.json(
      { error: "invalid_request" },
      { status: 404, headers },
    );
  } catch (error) {
    if (error instanceof OAuthError)
      return Response.json(
        { error: error.code, error_description: error.message },
        { status: error.status, headers },
      );
    return Response.json(
      {
        error: "invalid_request",
        error_description:
          "Could not complete authorization. Check the request or try again.",
      },
      { status: 400, headers },
    );
  } finally {
    release();
  }
}
