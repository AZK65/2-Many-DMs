// Explicit local model setup. Never run from postinstall or a public web request.
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";

const defaults = [
  ["Translation and reply drafting", "OLLAMA_TRANSLATION_MODEL", "translategemma:4b"],
  ["Image text search (OCR)", "OLLAMA_OCR_MODEL", "glm-ocr:latest"],
  ["Autocorrect and photo OCR", "OLLAMA_AUTOCORRECT_MODEL", "qwen3.5:4b"],
  ["Photo translation OCR", "OLLAMA_PHOTO_OCR_MODEL", "qwen3.5:4b"],
];
const normalize = name => name.includes(":") ? name : `${name}:latest`;

export function modelPlan(env = {}) {
  const choices = defaults.map(([purpose, key, fallback]) => ({ purpose, model: env[key]?.trim() || fallback }));
  if (env.OLLAMA_REPLY_MODEL?.trim()) choices.push({ purpose: "Reply drafting override", model: env.OLLAMA_REPLY_MODEL.trim() });
  const seen = new Set();
  return choices.filter(item => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(item.model) || /(?:^|[-:])cloud(?:$|-)/i.test(item.model)) {
      throw new Error("Choose a local Ollama model name in .env; remote URLs and cloud models are not supported by this installer.");
    }
    const key = normalize(item.model);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function localOrigin(value = "http://127.0.0.1:11434") {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("OLLAMA_URL must be a local HTTP loopback origin, such as http://127.0.0.1:11434. No remote host, credentials, or path is allowed.");
  }
  return url.origin;
}

async function timed(work, timeoutMs, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try { return await work(controller.signal); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export async function installedModels(origin, { fetchFn = fetch, signal } = {}) {
  return timed(async requestSignal => {
    const response = await fetchFn(`${localOrigin(origin)}/api/tags`, { signal: requestSignal, redirect: "error" });
    if (!response.ok) throw new Error(`Ollama model check failed (HTTP ${response.status}).`);
    const body = await response.json();
    if (!Array.isArray(body.models)) throw new Error("Ollama returned an invalid model list. Update or restart Ollama, then retry.");
    return new Set(body.models.filter(model => !model.remote_host && !model.remote_model && typeof (model.name || model.model) === "string").map(model => normalize(model.name || model.model)));
  }, 10_000, signal);
}

export async function pullModel(origin, model, { fetchFn = fetch, signal, log = console.log, timeoutMs = 30 * 60_000 } = {}) {
  // Validate independently, even when called without modelPlan.
  modelPlan({ OLLAMA_TRANSLATION_MODEL: model });
  return timed(async requestSignal => {
    const response = await fetchFn(`${localOrigin(origin)}/api/pull`, {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }), signal: requestSignal,
    });
    if (!response.ok || !response.body) throw new Error(`Could not download ${model} (HTTP ${response.status}). Check the model name and update Ollama, then retry.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", success = false, lastProgress = "";
    function consume(line) {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { throw new Error(`Unreadable download progress for ${model}. Retry setup.`); }
      if (event.error) throw new Error(`Download failed for ${model}: ${String(event.error).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 180)}`);
      if (event.status === "success") success = true;
      const percent = Number.isFinite(event.completed) && Number.isFinite(event.total) && event.total > 0 ? Math.min(100, Math.floor(event.completed / event.total * 10) * 10) : null;
      const progress = `${String(event.status || "Downloading").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120)}${percent === null ? "" : ` · ${percent}%`}`;
      if (progress !== lastProgress) { log(`  ${model}: ${progress}`); lastProgress = progress; }
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 1024 * 1024) throw new Error("Unexpectedly large model download response. Stop and check Ollama.");
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) consume(line);
      }
      consume(buffer + decoder.decode());
      if (!success) throw new Error(`Download of ${model} ended before success. Re-run setup to resume; existing models are kept.`);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }, timeoutMs, signal);
}

export async function installMissing(origin, plan, { fetchFn = fetch, signal, log = console.log } = {}) {
  const options = { fetchFn, signal, log };
  const installed = await installedModels(origin, options);
  for (const { model } of plan) {
    if (installed.has(normalize(model))) { log(`Already installed: ${model}`); continue; }
    await pullModel(origin, model, options);
  }
  const verified = await installedModels(origin, options);
  const missing = plan.filter(({ model }) => !verified.has(normalize(model)));
  if (missing.length) throw new Error(`Could not verify local models: ${missing.map(item => item.model).join(", ")}. Retry npm run setup:models. Cloud-backed model entries do not count as local.`);
  log("Local model files verified. No chat data was used and no models were loaded into memory. Keep Ollama running; inference still depends on your hardware.");
}

async function main() {
  config({ quiet: true });
  const args = process.argv.slice(2);
  const allowed = new Set(["--yes", "--check", "--dry-run", "--skip"]);
  if (args.some(arg => !allowed.has(arg))) throw new Error("Supported options: --yes, --check, --dry-run, --skip");
  if (args.includes("--skip")) { console.log("Local models skipped. Install later with npm run setup:models. Cloud AI is separate."); return; }
  const plan = modelPlan(process.env);
  const origin = localOrigin(process.env.OLLAMA_URL || undefined);
  console.log("2Many local models (workspace host only):");
  for (const item of plan) console.log(`  ${item.model} — ${item.purpose}`);
  console.log("Several GB of disk space and downloads are required. Review hardware needs and model licenses in docs/local-models.md. Weights stay in Ollama storage, never in Git.");
  if (args.includes("--dry-run")) { console.log("Plan only. No connections, downloads, or changes made."); return; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    let installed;
    try { installed = await installedModels(origin, { signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error("Cannot check local Ollama. Install or update it from https://ollama.com/download on this computer and open the app (or run ollama serve on a headless host). Keep it on loopback, then re-run npm run setup:models. No models were downloaded.");
    }
    const missing = plan.filter(({ model }) => !installed.has(normalize(model)));
    if (args.includes("--check")) {
      if (missing.length) throw new Error(`Missing local models: ${missing.map(item => item.model).join(", ")}. Run npm run setup:models.`);
      console.log("All configured local model files are installed. This check does not load models or test inference."); return;
    }
    if (!missing.length) { console.log("All configured local models are already installed. Nothing downloaded."); return; }
    console.log(`To download: ${missing.map(item => item.model).join(", ")}`);
    if (!args.includes("--yes")) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("No interactive terminal. After reviewing the model plan, use --yes to approve downloads or --skip to defer them. Nothing downloaded.");
      const input = createInterface({ input: process.stdin, output: process.stdout });
      let answer;
      try { answer = await input.question("Download missing models now? [y/N] ", { signal: controller.signal }); }
      finally { input.close(); }
      if (!/^y(?:es)?$/i.test(answer.trim())) { console.log("Models deferred. Run npm run setup:models when ready."); return; }
    }
    await installMissing(origin, plan, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Setup interrupted. Existing models are kept; re-run npm run setup:models to check and resume missing downloads.");
    if (error?.name === "AbortError") throw new Error("Ollama timed out. Check that it is running and has disk space, then retry npm run setup:models.");
    throw error;
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Setup stopped: ${error.message}`); process.exitCode = 1; });
}
