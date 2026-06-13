import { NextRequest, NextResponse } from "next/server";
import { runAutomation } from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Execute an automation now — messages every matched chat not on cooldown.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const summary = await runAutomation(params.id);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || String(e) },
      { status: 500 }
    );
  }
}
