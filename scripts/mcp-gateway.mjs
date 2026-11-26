#!/usr/bin/env node
// Put a trusted HTTPS tunnel in front of this loopback-only, MCP-only gateway.
// The app still authenticates every tool call; no credential is held here.
import http from "node:http";
import { pathToFileURL } from "node:url";

export function allowedMcpPath(pathname) {
  if (pathname.includes("%") || pathname.includes("\\")) return false;
  return (
    pathname === "/api/mcp" ||
    pathname === "/mcp/authorize" ||
    ["register", "authorize", "approve", "token", "revoke"].some(
      (action) => pathname === `/api/mcp/oauth/${action}`,
    ) ||
    [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ].includes(pathname) ||
    pathname.startsWith("/_next/static/")
  );
}

export function mcpProxyHeaders(incoming, host) {
  const headers = { host };
  for (const name of ["accept", "accept-encoding", "authorization", "content-type", "content-length", "origin", "user-agent", "mcp-protocol-version", "mcp-session-id", "x-tmd-oauth-consent"]) {
    if (incoming[name] !== undefined) headers[name] = incoming[name];
  }
  return headers;
}

export function mcpRequestTarget(target, origin) {
  // Accept only origin-form targets. Invalid or absolute request URLs must not
  // crash the gateway or choose a different upstream origin.
  if (!target?.startsWith("/") || target.startsWith("//") || target.includes("\\"))
    return null;
  try {
    const url = new URL(target, origin);
    return url.origin === origin && allowedMcpPath(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const publicUrl = new URL(
    process.env.MCP_PUBLIC_URL || "https://not-configured.invalid/api/mcp",
  );
  const appPort = Number(process.env.MCP_APP_PORT || "3000");
  const port = Number(process.env.MCP_GATEWAY_PORT || "4030");
  if (
    !process.env.MCP_PUBLIC_URL ||
    publicUrl.protocol !== "https:" ||
    publicUrl.pathname !== "/api/mcp" ||
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.username ||
    publicUrl.password ||
    ![appPort, port].every(
      (n) => Number.isInteger(n) && n > 1024 && n < 65536,
    ) ||
    appPort === port
  )
    throw new Error(
      "Set a valid HTTPS MCP_PUBLIC_URL and distinct local ports above 1024.",
    );
  http
    .createServer({ maxHeaderSize: 16384 }, (req, res) => {
      const url = mcpRequestTarget(req.url, publicUrl.origin);
      const allowedMethod =
        req.method === "GET" ||
        req.method === "HEAD" ||
        req.method === "POST" ||
        req.method === "DELETE";
      if (!allowedMethod || !url) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      // Do not trust forwarded host headers or route to any caller-chosen backend.
      const headers = mcpProxyHeaders(req.headers, publicUrl.host);
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: appPort,
          path: url.pathname + url.search,
          method: req.method,
          headers,
          timeout: 30_000,
        },
        (incoming) => {
          res.writeHead(incoming.statusCode || 502, {
            ...incoming.headers,
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
          });
          incoming.pipe(res);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end("MCP service unavailable");
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    })
    .listen(port, "127.0.0.1", () =>
      console.error(
        `MCP-only gateway listening on loopback port ${port}. Configure your HTTPS tunnel to this port.`,
      ),
    );
}
