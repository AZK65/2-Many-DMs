import { ASSISTANT_MODEL } from "./assistant-config";

export class AssistantError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function providerError(status: number): AssistantError {
  if (status === 401 || status === 403) return new AssistantError("OpenRouter rejected this key. Replace it in Settings → AI assistant.", 401);
  if (status === 402) return new AssistantError("Your OpenRouter credits or spending limit are exhausted. Add credits or adjust the limit in OpenRouter.", 402);
  if (status === 429) return new AssistantError("OpenRouter is rate-limiting requests. Please wait a moment before trying again.", 429);
  return new AssistantError("OpenRouter could not complete the request with our privacy settings. Try again later; no less-private fallback was used.", 502);
}

export async function validateAssistantKey(apiKey: unknown) {
  if (typeof apiKey !== "string" || apiKey.length < 20 || apiKey.length > 256 || !/^sk-or-[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new AssistantError("Paste a valid OpenRouter API key, starting with sk-or-.");
  }
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw providerError(response.status);
  const result = await response.json();
  if (!result.data || result.data.disabled === true) throw new AssistantError("This OpenRouter key is not active.");
  // Validation is a free metadata request. It never sends a chat excerpt.
}

export type AssistantToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ProviderMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: AssistantToolCall[]; tool_call_id?: string };

export async function assistantCompletion(apiKey: string, messages: ProviderMessage[], tools: unknown[], signal: AbortSignal) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "2Many DMs chat assistant" },
    body: JSON.stringify({ model: ASSISTANT_MODEL, messages, max_tokens: 1800, temperature: 0.2,
      provider: { data_collection: "deny", zdr: true, require_parameters: true },
      ...(tools.length ? { tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
    }),
  });
  if (!response.ok) throw providerError(response.status);
  const result = await response.json();
  if (result.error || !result.choices?.[0]?.message) throw new AssistantError("The AI provider returned an incomplete response. Please try again.", 502);
  return result.choices[0].message as ProviderMessage;
}
