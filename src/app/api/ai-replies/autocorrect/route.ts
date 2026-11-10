import { NextRequest, NextResponse } from "next/server";
import { autocorrectLocally } from "@/lib/local-autocorrect";

export const runtime = "nodejs";

export async function GET() {
  // Loading this route warms the local dictionaries before the first keystroke.
  return NextResponse.json({ ready: true });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      text?: unknown;
      fast?: unknown;
      strength?: unknown;
      preserveCasual?: unknown;
      fixPunctuation?: unknown;
    };
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }
    return NextResponse.json(
      await autocorrectLocally(body.text, req.signal, {
        fastOnly: body.fast === true,
        strength:
          body.strength === "light" || body.strength === "maximum"
            ? body.strength
            : "balanced",
        preserveCasual: body.preserveCasual !== false,
        fixPunctuation: body.fixPunctuation !== false,
      })
    );
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
