import { NextRequest, NextResponse } from "next/server";
import { draftReply, type DraftChatTurn } from "@/lib/reply-drafting";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: unknown;
      conversationId?: unknown;
      history?: unknown;
      seedDraft?: unknown;
    };
    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (turn): turn is DraftChatTurn =>
              !!turn &&
              typeof turn === "object" &&
              ["customer", "assistant"].includes((turn as DraftChatTurn).role) &&
              typeof (turn as DraftChatTurn).text === "string"
          )
          .slice(-12)
      : [];
    const result = await draftReply({
      message: typeof body.message === "string" ? body.message.slice(0, 4000) : undefined,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      seedDraft:
        typeof body.seedDraft === "string" ? body.seedDraft.slice(0, 4000) : undefined,
      history,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "A reply could not be drafted." },
      { status: 422 }
    );
  }
}
