import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy to the listener's own config API.
 *
 * watchers.json stays the source of truth over there — the listener keeps
 * working when Omni is down. This route exists so the browser never needs the
 * listener's URL or its API key; both stay server-side.
 */
function listenerUrl(path: string) {
  const base = process.env.LISTENING_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}${path}`;
}

function authHeaders(): Record<string, string> {
  const key = process.env.LISTENING_CONFIG_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export async function GET() {
  const url = listenerUrl("/api/watchers");
  if (!url) {
    return NextResponse.json({ error: "LISTENING_URL is not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return NextResponse.json({ error: `Listener returned ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ error: `Listener unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const url = listenerUrl("/api/watchers");
  if (!url) {
    return NextResponse.json({ error: "LISTENING_URL is not configured" }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Mirror the listener's own validation so bad input fails here with a clear
  // message instead of coming back as an opaque 400 from the proxy.
  const valid =
    Array.isArray(body) &&
    body.every(
      (w) =>
        w &&
        typeof w.name === "string" &&
        w.name.trim() &&
        typeof w.chatId === "string" &&
        Array.isArray(w.queries) &&
        w.queries.every((q: unknown) => typeof q === "string")
    );
  if (!valid) {
    return NextResponse.json(
      { error: "Expected an array of { name, chatId, queries[] }" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Listener returned ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ error: `Listener unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
