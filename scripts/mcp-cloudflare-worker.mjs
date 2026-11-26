import { allowedMcpPath, mcpProxyHeaders } from "./mcp-proxy-policy.mjs";

// Bind MCP_ORIGIN to one VPC Service: the loopback MCP gateway, never the
// whole private network or the CRM port. Authentication stays in the app.
const responseHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.origin !== env.PUBLIC_ORIGIN ||
      url.protocol !== "https:" ||
      !allowedMcpPath(url.pathname) ||
      !["GET", "HEAD", "POST", "DELETE"].includes(request.method)
    )
      return new Response("Not found", { status: 404, headers: responseHeaders });

    try {
      let body;
      if (request.body) {
        const reader = request.body.getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 16_384) {
              await reader.cancel();
              return new Response("Request too large", { status: 413, headers: responseHeaders });
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      }

      const headers = mcpProxyHeaders(Object.fromEntries(request.headers), url.host);
      // The VPC Service fixes the destination to the gateway's IP and port.
      // HTTP is only used on loopback after Cloudflare's encrypted tunnel.
      const upstream = await env.MCP_ORIGIN.fetch(new Request(
        `http://${url.host}${url.pathname}${url.search}`,
        { method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(30_000) },
      ));
      const result = new Response(upstream.body, upstream);
      for (const [name, value] of Object.entries(responseHeaders)) result.headers.set(name, value);
      result.headers.delete("set-cookie");
      return result;
    } catch {
      return new Response("MCP service unavailable. Check that the app and computer are running.", {
        status: 503, headers: responseHeaders,
      });
    }
  },
};
