import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { assistantConfig } from "@/lib/assistant-config";
import { AssistantError, type ProviderMessage } from "@/lib/assistant-provider";
import { answerFromChats } from "@/lib/chat-assistant";
import { assistantDenied, assistantBody } from "@/lib/assistant-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const state = globalThis as typeof globalThis & { assistantBusy?: Set<string> };
const busy = state.assistantBusy ??= new Set();
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (assistantDenied(request)) return json({ error: "AI assistant is owner-only and requires a same-origin request." }, 403);
  let lock: string | undefined;
  try {
    const body = await assistantBody(request, 32000);
    if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 3000) throw new AssistantError("Ask a question of up to 3,000 characters.");
    if (body.conversationId != null && (typeof body.conversationId !== "string" || body.conversationId.length > 150)) throw new AssistantError("Invalid chat scope.");
    const user = await getCurrentUser();
    if (busy.has(user.id)) throw new AssistantError("An answer is already being prepared. Wait for it to finish.", 429);
    busy.add(user.id); lock = user.id;
    const apiKey = await assistantConfig.read(user.id);
    if (!apiKey) throw new AssistantError("Add an OpenRouter key in Settings → AI assistant first.", 409);
    let timezone = "UTC";
    try { if (typeof body.timezone === "string" && body.timezone.length < 100) timezone = new Intl.DateTimeFormat("en", { timeZone: body.timezone }).resolvedOptions().timeZone; } catch {}
    const history: ProviderMessage[] = Array.isArray(body.history) ? body.history.slice(-6).filter((item: ProviderMessage) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").map((item: ProviderMessage) => ({ role: item.role, content: item.content!.slice(0, 3000) })) : [];
    const result = await answerFromChats({ userId: user.id, apiKey, question: body.question.trim(), history, conversationId: body.conversationId || undefined, timezone, signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]) });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof AssistantError ? error.message : "The assistant could not finish. Your chats have not changed. Try again or narrow your question." }, error instanceof AssistantError ? error.status : 503);
  } finally { if (lock) busy.delete(lock); }
}
