import { NextRequest, NextResponse } from "next/server";
import { enforceLeadRetention, purgeLead } from "@/lib/listening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Erasure and retention for the CRM's copy of the lead data.
 *
 * The listener has its own purge CLI for the files it holds; this covers the
 * SocialLead table. To fully forget someone, do both:
 *
 *   POST /api/listening/purge  { "username": "@someone" }
 *   npm run purge -- --user @someone      (in the listener project)
 *
 * POST with { "sweep": true } runs age-based retention on demand; it also runs
 * automatically after every ingest.
 */
export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.sweep) {
    const expired = await enforceLeadRetention();
    return NextResponse.json({ ok: true, expired });
  }

  if (!body.username && !body.postId) {
    return NextResponse.json(
      { error: "Provide username, postId, or sweep: true" },
      { status: 400 }
    );
  }

  const { deleted } = await purgeLead({ username: body.username, postId: body.postId });

  return NextResponse.json({
    ok: true,
    deleted,
    reminder:
      "Also run `npm run purge -- --user @them` in the listener project — it keeps its own copy.",
  });
}
