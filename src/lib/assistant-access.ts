import { sameSetupOrigin } from "./setup-origin";
import { isGuestCookie, SHARE_COOKIE } from "./share-auth";
import { AssistantError } from "./assistant-provider";

export function assistantDenied(request: Request) {
  const cookie = (request.headers.get("cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${SHARE_COOKIE}=`))?.slice(SHARE_COOKIE.length + 1);
  return process.env.MARKETING_ONLY === "1" || request.headers.get("x-tmd-guest") === "1" || isGuestCookie(cookie) || !sameSetupOrigin(request);
}

/** Bound the stream itself, not just the declared Content-Length. */
export async function assistantBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (!request.body) throw new AssistantError("A JSON request is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AssistantError("Request is too large.", 413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid object");
    return body;
  } catch (error) { if (error instanceof AssistantError) throw error; throw new AssistantError("Send a valid JSON object."); }
  finally { reader.releaseLock(); }
}
