import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentAccessStore,
  claimAgentRequest,
  mcpRequestAllowed,
} from "./mcp-access";

test("keys persist only as digests, survive restart, revoke, and never cross workspace boundaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-access-"));
  try {
    const store = agentAccessStore(root);
    assert.equal(store.authenticate(null), null);
    const { key, token } = store.create("Assistant", ["account-a"]);
    const file = path.join(root, ".local/mcp/access.json");
    assert.ok(!fs.readFileSync(file, "utf8").includes(token));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(store.list()).includes("digest"));
    assert.equal(
      agentAccessStore(root).authenticate(`Bearer ${token}`)?.id,
      key.id,
    );
    assert.equal(
      agentAccessStore(path.join(root, "other-workspace")).authenticate(
        `Bearer ${token}`,
      ),
      null,
    );
    assert.equal(store.authenticate(`Bearer ${token}x`), null);
    store.revoke(key.id);
    assert.equal(store.authenticate(`Bearer ${token}`), null);
    fs.writeFileSync(file, "broken");
    assert.throws(() => store.create("New agent", ["a"]));
    assert.throws(() => store.authenticate(`Bearer ${token}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only loopback owner can manage keys; remote MCP needs explicit hostname and valid origin", () => {
  const previous = {
    marketing: process.env.MARKETING_ONLY,
    remote: process.env.MCP_PUBLIC_URL,
  };
  const req = (host: string, extra: Record<string, string> = {}) =>
    new Request("http://localhost/api/mcp", { headers: { host, ...extra } });
  try {
    delete process.env.MARKETING_ONLY;
    delete process.env.MCP_PUBLIC_URL;
    assert.ok(mcpRequestAllowed(req("127.0.0.1:3000")));
    assert.ok(mcpRequestAllowed(req("[::1]:3000")));
    assert.ok(!mcpRequestAllowed(req("evil.example")));
    assert.ok(
      !mcpRequestAllowed(
        req("127.0.0.1:3000", { origin: "https://evil.example" }),
      ),
    );
    assert.ok(!mcpRequestAllowed(req("127.0.0.1:3000"), true));
    assert.ok(
      mcpRequestAllowed(
        req("127.0.0.1:3000", { "x-tmd-agent-settings": "1" }),
        true,
      ),
    );
    process.env.MCP_PUBLIC_URL = "https://agents.example/api/mcp";
    assert.ok(mcpRequestAllowed(req("agents.example")));
    assert.ok(
      !mcpRequestAllowed(
        req("agents.example", { origin: "http://agents.example" }),
      ),
    );
    assert.ok(
      !mcpRequestAllowed(
        req("agents.example", { "x-tmd-agent-settings": "1" }),
        true,
      ),
    );
    process.env.MARKETING_ONLY = "1";
    assert.ok(!mcpRequestAllowed(req("127.0.0.1:3000")));
  } finally {
    for (const [key, value] of [
      ["MARKETING_ONLY", previous.marketing],
      ["MCP_PUBLIC_URL", previous.remote],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});

test("per-agent request limits isolate agents and recover after the window", () => {
  const releases = Array.from(
    { length: 4 },
    () => claimAgentRequest("limit-test", 1000)!,
  );
  assert.equal(claimAgentRequest("limit-test", 1001), null);
  assert.ok(claimAgentRequest("other-agent", 1001));
  releases.forEach((release) => release());
  for (let i = 4; i < 60; i++) claimAgentRequest("limit-test", 1001)!();
  assert.equal(claimAgentRequest("limit-test", 1002), null);
  assert.ok(claimAgentRequest("limit-test", 61001));
});
