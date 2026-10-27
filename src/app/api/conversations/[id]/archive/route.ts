import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARCHIVE_TIMEOUT_MS = Number(
  process.env.CONTROL_ARCHIVE_TIMEOUT_MS || 15000
);

type WorkerResult = { error?: string };

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = (await req.json().catch(() => ({}))) as { archived?: unknown };
  if (typeof body.archived !== "boolean") {
    return NextResponse.json(
      { error: "Choose whether to archive or restore this chat." },
      { status: 400 }
    );
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      platform: true,
      accountId: true,
      externalId: true,
      archived: true,
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (conversation.platform !== "telegram" && conversation.platform !== "whatsapp") {
    return NextResponse.json(
      { error: "Archive and mute is available for Telegram and WhatsApp chats." },
      { status: 409 }
    );
  }
  if (!conversation.externalId || !conversation.accountId) {
    return NextResponse.json(
      { error: "This chat is not linked to a connected messaging account." },
      { status: 409 }
    );
  }

  if (conversation.archived === body.archived) {
    return NextResponse.json({ ok: true, archived: conversation.archived });
  }

  const lastMessage = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      externalKey: { not: null },
      NOT: { externalKey: { contains: ":pending:" } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      externalKey: true,
      createdAt: true,
      direction: true,
      senderContact: { select: { externalKey: true } },
    },
  });

  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  let response: Response;
  try {
    response = await fetch(`${controlUrl}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: conversation.platform,
        accountId: conversation.accountId,
        chatExternalId: conversation.externalId,
        archived: body.archived,
        lastMessageId: lastMessage?.externalKey,
        lastMessageTimestamp: lastMessage?.createdAt.getTime(),
        lastMessageFromMe: lastMessage?.direction === "out",
        lastMessageParticipant: lastMessage?.senderContact?.externalKey,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "The platform did not confirm the archive. Nothing changed in Omni; check the native app before trying again."
            : "The sync worker is offline. Start it in Connections and try again.",
      },
      { status: error instanceof Error && error.name === "TimeoutError" ? 504 : 503 }
    );
  }

  const result = (await response.json().catch(() => ({}))) as WorkerResult;
  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          result.error?.replace(/^Error:\s*/, "") ||
          "The connected account could not update this chat.",
      },
      { status: response.status === 504 ? 504 : response.status === 503 ? 503 : 502 }
    );
  }

  // Commit Omni's state only after the source platform confirms both archive
  // and mute. This prevents a failed native action from silently hiding a chat.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      archived: body.archived,
      status: body.archived ? "done" : "open",
      snoozedUntil: null,
      followUpAt: null,
    },
  });

  return NextResponse.json({ ok: true, archived: body.archived });
}
