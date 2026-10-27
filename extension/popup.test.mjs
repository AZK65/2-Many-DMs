import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./popup.js", import.meta.url), "utf8");
function fixture({ granted = true, cookies = {}, fetcher } = {}) {
  const nodes = Object.fromEntries(["appUrl", "code", "status", "connect", "setup"].map(id => [id, { value: "", disabled: false, textContent: "", className: "", addEventListener(_, fn) { this.submit = fn; } }]));
  const reads = [], requests = [], saved = [], permissions = [];
  vm.runInNewContext(source, {
    document: { getElementById: id => nodes[id] }, URL, AbortSignal,
    chrome: {
      storage: { local: { get: (_, fn) => fn({}), remove: () => {}, set: async value => saved.push(value) } },
      permissions: { request: async value => { permissions.push(value); return granted; } },
      cookies: { get: async ({ url, name }) => { reads.push({url, name}); return cookies[url]?.[name] ? {value: cookies[url][name]} : null; } },
    },
    fetch: async (url, options) => { requests.push({url, options}); return fetcher ? fetcher() : {ok: true, json: async () => ({ok: true})}; },
  });
  nodes.code.value = "ABCDE12345";
  return { nodes, reads, requests, saved, permissions, submit: () => nodes.setup.submit({preventDefault() {}}) };
}
test("extension refuses insecure remote URLs before reading session cookies", async () => {
  const f = fixture(); f.nodes.appUrl.value = "http://example.com";
  await f.submit(); assert.equal(f.reads.length, 0); assert.equal(f.requests.length, 0);
  assert.match(f.nodes.status.textContent, /HTTPS/);
});
test("extension waits for explicit host permission and never reads cookies after denial", async () => {
  const f = fixture({granted: false}); await f.submit();
  assert.equal(f.permissions.length, 1); assert.equal(f.reads.length, 0); assert.equal(f.nodes.connect.disabled, false);
});
test("extension never mixes partial X and Twitter cookie pairs", async () => {
  const f = fixture({cookies: {"https://x.com": {auth_token: "fake-auth"}, "https://twitter.com": {ct0: "fake-csrf"}}});
  await f.submit(); assert.equal(f.requests.length, 0); assert.match(f.nodes.status.textContent, /sign in/);
});
test("extension sends only to the selected origin without redirects, stores no credentials or codes", async () => {
  const f = fixture({cookies: {"https://x.com": {auth_token: "fixture-auth", ct0: "fixture-csrf"}}});
  f.nodes.appUrl.value = "https://private.example.test/some/path";
  await f.submit(); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "https://private.example.test/api/accounts/x/connect");
  assert.equal(f.requests[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(f.requests[0].options.body), {code: "ABCDE12345", authToken: "fixture-auth", ct0: "fixture-csrf"});
  assert.equal(JSON.stringify(f.saved), '[{"appUrl":"https://private.example.test"}]');
  assert.equal(f.nodes.code.value, ""); assert.match(f.nodes.status.textContent, /Session saved/);
});
test("extension suppresses simultaneous submissions and recovers the button after failure", async () => {
  let finish;
  const f = fixture({cookies: {"https://x.com": {auth_token: "fixture-auth", ct0: "fixture-csrf"}}, fetcher: () => new Promise(resolve => { finish = resolve; })});
  const first = f.submit(); await f.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  finish({ok: false, json: async () => ({error: "Code expired. Request a new one."})});
  await first; assert.equal(f.nodes.connect.disabled, false); assert.match(f.nodes.status.textContent, /Code expired/);
});
