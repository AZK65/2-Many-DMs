import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { assistantDenied, assistantBody } from "@/lib/assistant-access";
import { assistantConfig, ASSISTANT_MODEL } from "@/lib/assistant-config";
import { AssistantError, validateAssistantKey } from "@/lib/assistant-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function handle(request: Request) {
  if (assistantDenied(request)) return json({ error: "AI settings are owner-only and require a same-origin request." }, 403);
  try {
    const user = await getCurrentUser();
    if (request.method === "DELETE") await assistantConfig.remove(user.id);
    if (request.method === "POST") {
      const body = await assistantBody(request, 2048);
      if (body.consent !== true) throw new AssistantError("Confirm that questions and relevant excerpts may be sent to OpenRouter.");
      const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      await validateAssistantKey(key);
      await assistantConfig.save(user.id, key);
    }
    return json({ configured: !!await assistantConfig.read(user.id), model: ASSISTANT_MODEL });
  } catch (error) {
    return json({ error: error instanceof AssistantError ? error.message : "Could not load or save AI settings. Check your connection and try again." }, error instanceof AssistantError ? error.status : 503);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
