import { NextRequest } from "next/server";
import { inboxEventStream } from "@/lib/inbox-events";
import { sameSetupOrigin } from "@/lib/setup-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  // The normal inbox middleware remains authoritative; never enable CORS here.
  if (!sameSetupOrigin(req) || req.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403 });
  }
  return new Response(inboxEventStream(req.signal), { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "private, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
