import { NextResponse } from "next/server";
import { getReplyVoiceProfile } from "@/lib/reply-drafting";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getReplyVoiceProfile());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Voice profile could not be loaded." },
      { status: 500 }
    );
  }
}
