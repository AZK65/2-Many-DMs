import test from "node:test";
import assert from "node:assert/strict";
import { allowedMcpPath, mcpProxyHeaders, mcpRequestTarget } from "./mcp-gateway.mjs";
test("remote gateway exposes only MCP, OAuth and static assets", () => {
  for (const route of [
    "/api/mcp",
    "/mcp/authorize",
    "/api/mcp/oauth/token",
    "/api/mcp/oauth/approve",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/_next/static/chunks/example.js",
  ])
    assert.ok(allowedMcpPath(route), route);
  for (const route of [
    "/",
    "/api/mcp/access",
    "/api/accounts",
    "/api/conversations",
    "/api/mcp/oauth/unknown",
    "/media/private.jpg",
    "/_next/data/private.json",
    "/api/mcp/access.json",
  ])
    assert.ok(!allowedMcpPath(route), route);
});
test("gateway strips routing overrides, cookies and owner-management headers", () => {
  assert.deepEqual(mcpProxyHeaders({ authorization: "Bearer demo", "x-tmd-oauth-consent": "1", "x-tmd-agent-settings": "1", cookie: "owner", "x-invoke-path": "/api/mcp/access", "x-forwarded-host": "localhost", "x-middleware-subrequest": "middleware" }, "mcp.example"), { host: "mcp.example", authorization: "Bearer demo", "x-tmd-oauth-consent": "1" });
  assert.equal(allowedMcpPath("/_next/static/%2f..%2fapi/mcp/access"), false);
});
test("malformed and absolute request targets cannot crash or redirect the gateway", () => {
  for (const target of [undefined, "http://[", "https://elsewhere.example/api/mcp", "//elsewhere.example/api/mcp", "/\\elsewhere.example/api/mcp", "/api/mcp/../accounts"])
    assert.equal(mcpRequestTarget(target, "https://mcp.example"), null);
  assert.equal(mcpRequestTarget("/mcp/authorize?state=demo", "https://mcp.example")?.pathname, "/mcp/authorize");
});
