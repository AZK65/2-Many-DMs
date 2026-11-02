/** No remote hosts, redirects, cloud aliases or fallback providers. */
export function localOllamaOrigin(value = process.env.OLLAMA_URL || "http://127.0.0.1:11434") {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local AI only accepts an Ollama HTTP address on this machine, without credentials or a path.");
  }
  // Do not depend on a user-configurable localhost DNS entry.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

export async function localOllamaFetch(endpoint: string, init: RequestInit = {}, timeoutMs = 90_000) {
  const origin = localOllamaOrigin();
  if (!/^\/api\/[a-z]+$/.test(endpoint)) throw new Error("Unsupported local AI operation.");
  return fetch(`${origin}${endpoint}`, { ...init, cache: "no-store", redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
}

export async function requireLocalModel(model: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(model) || /(?:^|[-:])cloud(?:$|-)/i.test(model)) {
    throw new Error("Cloud models are disabled for local OCR and translation. Choose a downloaded local model.");
  }
  let response: Response;
  try {
    response = await localOllamaFetch("/api/show", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }) }, 10_000);
  } catch {
    throw new Error("Local AI is unavailable. Open Ollama on this computer and check that OLLAMA_URL is a local address. No cloud service was used.");
  }
  if (response.status === 404) throw new Error(`Local model missing. Run ollama pull ${model} in Terminal, then try again. This downloads model files, not your photos or chats.`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.remote_host || data.remote_model || !data.model_info || !Object.keys(data.model_info).length) {
    throw new Error("Could not verify downloaded local model weights. Cloud inference is disabled. Install a local Ollama model and retry.");
  }
}
