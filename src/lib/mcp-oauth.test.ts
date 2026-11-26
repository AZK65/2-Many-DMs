import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { agentAccessStore } from "./mcp-access";
import { oauthStore, mcpResource } from "./mcp-oauth";
import { oauthHttp } from "./mcp-oauth-http";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-oauth-"));
  let now = Date.now();
  const access = agentAccessStore(root);
  const oauth = oauthStore(root, () => now);
  const key = access.create("Cloud agent", ["selected-account"]);
  const client = oauth.register({
    client_name: "Demo agent",
    redirect_uris: ["https://agent.example/callback"],
    token_endpoint_auth_method: "none",
  });
  const verifier = "v".repeat(64);
  const resource = "https://mcp.example/api/mcp";
  const request = {
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    scope: "chats:read",
    state: "state-from-client",
    resource,
  };
  const code = () =>
    new URL(
      oauth.approve(request, key.token, resource).redirect,
    ).searchParams.get("code")!;
  const exchange = (value = code(), overrides = {}) =>
    oauth.exchange(
      {
        grant_type: "authorization_code",
        code: value,
        client_id: client.client_id,
        redirect_uri: request.redirect_uri,
        code_verifier: verifier,
        resource,
        ...overrides,
      },
      resource,
    );
  return {
    root,
    access,
    oauth,
    key,
    client,
    verifier,
    resource,
    request,
    code,
    exchange,
    advance: (ms: number) => {
      now += ms;
    },
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("OAuth PKCE flow grants selected accounts; refresh rotates and revoking the parent key stops both tokens", () => {
  const f = fixture();
  try {
    const redirect = new URL(
      f.oauth.approve(f.request, f.key.token, f.resource).redirect,
    );
    assert.equal(redirect.searchParams.get("state"), "state-from-client");
    const issued = f.exchange(redirect.searchParams.get("code")!);
    assert.deepEqual(
      f.oauth.authenticate(`Bearer ${issued.access_token}`, f.resource)
        ?.accountIds,
      ["selected-account"],
    );
    assert.equal(
      f.oauth.authenticate(
        `Bearer ${issued.access_token}`,
        "https://other.example/api/mcp",
      ),
      null,
    );
    const file = fs.readFileSync(
      path.join(f.root, ".local/mcp/oauth/state.json"),
      "utf8",
    );
    for (const secret of [
      f.key.token,
      issued.access_token,
      issued.refresh_token,
      redirect.searchParams.get("code")!,
    ])
      assert.ok(!file.includes(secret));
    const refresh = {
      grant_type: "refresh_token",
      refresh_token: issued.refresh_token,
      client_id: f.client.client_id,
      resource: f.resource,
    };
    const rotated = f.oauth.exchange(refresh, f.resource);
    assert.equal(
      f.oauth.authenticate(`Bearer ${issued.access_token}`, f.resource),
      null,
    );
    assert.throws(() => f.oauth.exchange(refresh, f.resource));
    f.access.revoke(f.key.key.id);
    assert.equal(
      f.oauth.authenticate(`Bearer ${rotated.access_token}`, f.resource),
      null,
    );
    assert.throws(() =>
      f.oauth.exchange(
        { ...refresh, refresh_token: rotated.refresh_token },
        f.resource,
      ),
    );
  } finally {
    f.close();
  }
});
test("codes bind client, return address, verifier and resource, expire, and cannot be reused", () => {
  const f = fixture();
  try {
    const code = f.code();
    for (const overrides of [
      { client_id: "other" },
      { redirect_uri: "https://evil.example" },
      { code_verifier: "wrong" },
      { resource: "https://other.example/api/mcp" },
    ])
      assert.throws(() => f.exchange(code, overrides));
    f.exchange(code);
    assert.throws(() => f.exchange(code));
    const expired = f.code();
    f.advance(6 * 60_000);
    assert.throws(() => f.exchange(expired));
    const issued = f.exchange();
    f.advance(16 * 60_000);
    assert.equal(
      f.oauth.authenticate(`Bearer ${issued.access_token}`, f.resource),
      null,
    );
    f.advance(31 * 24 * 60 * 60_000);
    assert.throws(() =>
      f.oauth.exchange(
        {
          grant_type: "refresh_token",
          client_id: f.client.client_id,
          refresh_token: issued.refresh_token,
        },
        f.resource,
      ),
    );
  } finally {
    f.close();
  }
});
test("consent never accepts unknown redirects, plaintext PKCE, write scopes, or revoked keys", () => {
  const f = fixture();
  try {
    for (const uri of [
      "javascript:alert(1)",
      "http://agent.example/callback",
      "https://user:password@agent.example/callback",
      "https://agent.example/#fragment",
    ])
      assert.throws(() => f.oauth.register({ redirect_uris: [uri] }));
    for (const change of [
      { redirect_uri: "https://evil.example" },
      { code_challenge_method: "plain" },
      { scope: "chats:write" },
      { response_type: "token" },
    ])
      assert.throws(() =>
        f.oauth.approve({ ...f.request, ...change }, f.key.token, f.resource),
      );
    f.access.revoke(f.key.key.id);
    assert.throws(() => f.oauth.approve(f.request, f.key.token, f.resource));
  } finally {
    f.close();
  }
});
test("OAuth discovery advertises PKCE; consent POST rejects cross-origin approval", async () => {
  const f = fixture();
  const old = process.env.DATA_DIR;
  const remote = process.env.MCP_PUBLIC_URL;
  process.env.DATA_DIR = f.root;
  delete process.env.MCP_PUBLIC_URL;
  try {
    const metadata = await oauthHttp(
      new Request(
        "http://127.0.0.1:3000/.well-known/oauth-authorization-server",
        { headers: { host: "127.0.0.1:3000" } },
      ),
      "metadata",
    );
    assert.deepEqual((await metadata.json()).code_challenge_methods_supported, [
      "S256",
    ]);
    const rejected = await oauthHttp(
      new Request("http://127.0.0.1:3000/api/mcp/oauth/approve", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          "Content-Type": "application/json",
          origin: "https://evil.example",
          "x-tmd-oauth-consent": "1",
        },
        body: JSON.stringify({ request: f.request, key: f.key.token }),
      }),
      "approve",
    );
    assert.equal(rejected.status, 403);
    process.env.MCP_PUBLIC_URL = "https://mcp.example/api/mcp";
    assert.equal(
      mcpResource(new Request("http://localhost/")),
      "https://mcp.example/api/mcp",
    );
    process.env.MCP_PUBLIC_URL = "http://mcp.example/api/mcp";
    assert.throws(() => mcpResource(new Request("http://localhost/")));
  } finally {
    if (old === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = old;
    if (remote === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = remote;
    f.close();
  }
});
