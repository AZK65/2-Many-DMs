import { NextRequest, NextResponse } from "next/server";
import { ingestRun, ingestSecretValid } from "@/lib/listening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives runs from the standalone X listener.
 *
 * This is the one API path exempted from the guest-cookie check in
 * middleware.ts — the caller is a server, not a browser. It authenticates with
 * the LISTENING_INGEST_SECRET bearer token instead. If that env var is unset
 * the endpoint refuses everything rather than falling open.
 */
export async function POST(req: NextRequest) {
  if (!ingestSecretValid(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await ingestRun(payload);
    // The listener logs `inserted` from this response.
    return NextResponse.json({ ok: true, inserted: result.created, ...result });
  } catch (e) {
    console.error("[listening] ingest failed:", e);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
