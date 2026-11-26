import test from "node:test";
import assert from "node:assert/strict";
import worker from "./mcp-cloudflare-worker.mjs";

test("hosted gateway restricts routes and strips owner and routing headers", async () => {
  let forwarded;
  const env = { PUBLIC_ORIGIN: "https://mcp.example", MCP_ORIGIN: { async fetch(request) {
    forwarded = request;
    return new Response("authenticated upstream result", { headers: { "set-cookie": "private" } });
  } } };
  for (const url of ["https://mcp.example/", "https://mcp.example/api/mcp/access", "https://mcp.example/api/accounts", "https://other.example/api/mcp", "http://mcp.example/api/mcp", "https://mcp.example/_next/static/%2fsecret"]) {
    assert.equal((await worker.fetch(new Request(url), env)).status, 404);
    assert.equal(forwarded, undefined);
  }
  const response = await worker.fetch(new Request("https://mcp.example/api/mcp", {
    method: "POST", body: "{}", headers: { authorization: "Bearer test-token", cookie: "owner", "x-tmd-agent-settings": "1", "x-invoke-path": "/api/accounts", origin: "https://mcp.example" },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "http://mcp.example/api/mcp");
  assert.equal(forwarded.headers.get("authorization"), "Bearer test-token");
  assert.equal(forwarded.headers.get("origin"), "https://mcp.example");
  for (const key of ["cookie", "x-tmd-agent-settings", "x-invoke-path"]) assert.equal(forwarded.headers.get(key), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("hosted gateway bounds bodies and reports origin outages without details", async () => {
  let called = false;
  const env = { PUBLIC_ORIGIN: "https://mcp.example", MCP_ORIGIN: { async fetch() {
    called = true; throw new Error("private infrastructure detail");
  } } };
  const large = await worker.fetch(new Request("https://mcp.example/api/mcp", { method: "POST", body: "x".repeat(16_385) }), env);
  assert.equal(large.status, 413); assert.equal(called, false);
  const failed = await worker.fetch(new Request("https://mcp.example/api/mcp", { method: "POST", body: "{}" }), env);
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private infrastructure detail/);
});
