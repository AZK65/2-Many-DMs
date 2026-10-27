import { NextRequest, NextResponse } from "next/server";
import { autocorrectLocally } from "@/lib/local-autocorrect";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }
    return NextResponse.json(await autocorrectLocally(body.text, req.signal));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Local autocorrect is unavailable.",
      },
      { status: 503 }
    );
  }
}
