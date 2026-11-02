import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { installMissing, installedModels, localOrigin, modelPlan, pullModel } from "./setup-local-models.mjs";

const origin = "http://127.0.0.1:11434";
const quiet = () => {};
const response = value => new Response(JSON.stringify(value));
const stream = lines => new Response(lines.join("\n"));

test("default plan matches the repo; overrides are respected and deduplicated", () => {
  assert.deepEqual(modelPlan().map(item => item.model), ["translategemma:4b", "glm-ocr:latest", "qwen3.5:4b"]);
  const plan = modelPlan({ OLLAMA_TRANSLATION_MODEL: "small:4b", OLLAMA_REPLY_MODEL: "small:4b", OLLAMA_OCR_MODEL: "reader", OLLAMA_AUTOCORRECT_MODEL: "reader:latest" });
  assert.deepEqual(plan.map(item => item.model), ["small:4b", "reader", "qwen3.5:4b"]);
  assert.ok(modelPlan({ OLLAMA_PHOTO_OCR_MODEL: "vision:small" }).some(item => item.model === "vision:small"));
  assert.throws(() => modelPlan({ OLLAMA_PHOTO_OCR_MODEL: "vision:cloud" }));
  for (const model of ["model:cloud", "model:4b-cloud", "https://remote.example/model", "bad; command", "../name"]) assert.throws(() => modelPlan({ OLLAMA_REPLY_MODEL: model }));
});

test("installer only accepts loopback origins without paths or credentials", () => {
  for (const host of [origin, "http://localhost:11434/", "http://[::1]:11434"]) assert.ok(localOrigin(host));
  for (const host of ["https://remote.example", "http://127.0.0.1.evil.example", "http://user:pass@localhost:11434", "http://localhost:11434/api", "http://localhost:11434?x=1", "https://localhost:11434"]) assert.throws(() => localOrigin(host));
});

test("skips installed local models and pulls only missing models sequentially", async () => {
  const plan = modelPlan(); const stored = new Set([plan[0].model]); const calls = []; let active = 0;
  const fetchFn = async (url, init) => {
    assert.equal(init.redirect, "error");
    if (url.endsWith("/tags")) return response({ models: [...stored].map(name => ({ name })) });
    assert.equal(active++, 0);
    const { model, stream: streaming } = JSON.parse(init.body); assert.equal(streaming, true); calls.push(model);
    stored.add(model); active--;
    return stream(['{"status":"pulling","completed":10,"total":100}', '{"status":"success"}']);
  };
  await installMissing(origin, plan, { fetchFn, log: quiet });
  assert.deepEqual(calls, ["glm-ocr:latest", "qwen3.5:4b"]);
  calls.length = 0;
  await installMissing(origin, plan, { fetchFn, log: quiet }); assert.deepEqual(calls, []);
});

test("does not mistake remote models or invalid tag responses for installed files", async () => {
  const models = await installedModels(origin, { fetchFn: async () => response({ models: [{ name: "local" }, { name: "cloud", remote_host: "https://remote.example" }] }) });
  assert.deepEqual([...models], ["local:latest"]);
  await assert.rejects(installedModels(origin, { fetchFn: async () => response({ wrong: [] }) }), /invalid model list/);
  await assert.rejects(installedModels(origin, { fetchFn: async () => new Response("no", { status: 500 }) }), /HTTP 500/);
});

test("supports split progress chunks and no final newline", async () => {
  const chunks = ['{"sta', 'tus":"pulling","completed":20,"total":100}\n', '{"status":"success"}'];
  const fetchFn = async () => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }));
  const messages = [];
  await pullModel(origin, "example:4b", { fetchFn, log: line => messages.push(line) });
  assert.ok(messages.some(line => line.includes("20%"))); assert.ok(messages.some(line => line.includes("success")));
});

test("HTTP, API errors, invalid progress, and premature completion fail honestly", async () => {
  for (const [result, expected] of [[new Response("no", { status: 404 }), /HTTP 404/], [stream(['{"error":"no space left"}']), /no space left/], [stream(["not json"]), /Unreadable/], [stream(['{"status":"pulling"}']), /before success/]]) {
    await assert.rejects(pullModel(origin, "example:4b", { fetchFn: async () => result, log: quiet }), expected);
  }
});

test("successful pull still requires a verified local model list", async () => {
  const fetchFn = async url => url.endsWith("/tags") ? response({ models: [] }) : stream(['{"status":"success"}']);
  await assert.rejects(installMissing(origin, [{ model: "example:4b" }], { fetchFn, log: quiet }), /Could not verify/);
});

test("a timeout or cancellation aborts a pending pull", async () => {
  const fetchFn = async (_url, { signal }) => new Promise((_resolve, reject) => {
    const stop = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
  await assert.rejects(pullModel(origin, "example:4b", { fetchFn, log: quiet, timeoutMs: 5 }), { name: "AbortError" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pullModel(origin, "example:4b", { fetchFn, log: quiet, signal: controller.signal }), { name: "AbortError" });
});

test("dry run and explicit skip never need a running model service", () => {
  const env = { ...process.env, OLLAMA_URL: "http://127.0.0.1:1", DOTENV_CONFIG_QUIET: "true" };
  for (const [arg, expected] of [["--dry-run", /No connections, downloads/], ["--skip", /skipped/]]) {
    const result = spawnSync(process.execPath, ["scripts/setup-local-models.mjs", arg], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, expected);
  }
});
