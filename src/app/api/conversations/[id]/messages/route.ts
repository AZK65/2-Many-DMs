import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { MessageDTO } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Opening a conversation clears its unread count.
  await prisma.conversation.update({
    where: { id: params.id },
    data: { unread: 0 },
  });

  const messages = await prisma.message.findMany({
    where: { conversationId: params.id },
    orderBy: { createdAt: "asc" },
  });

  const data: MessageDTO[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    direction: m.direction as "in" | "out",
    mediaType: (m.mediaType as MessageDTO["mediaType"]) ?? null,
    mediaUrl: m.mediaUrl ?? null,
    mediaName: m.mediaName ?? null,
    createdAt: m.createdAt.toISOString(),
  }));

  return NextResponse.json(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { body } = await req.json();
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { id: true, platform: true, externalId: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Real platform conversations carry an externalId — send through the sync
  // worker so the message actually leaves on Telegram/WhatsApp/X. Mock
  // conversations have no externalId and are simply stored locally.
  let externalKey: string | undefined;
  let createdAt = new Date();

  if (conversation.externalId) {
    const controlUrl =
      process.env.SYNC_CONTROL_URL || "http://localhost:4001";
    let res: Response;
    try {
      res = await fetch(`${controlUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: conversation.platform,
          chatExternalId: conversation.externalId,
          text,
        }),
      });
    } catch {
      return NextResponse.json(
        { error: "Sync worker unreachable. Is `npm run sync` running?" },
        { status: 502 }
      );
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: detail.error || "Send failed on platform" },
        { status: 502 }
      );
    }
    const sent = await res.json();
    externalKey = sent.messageExternalId;
    createdAt = new Date(sent.timestamp);
  }

  // Upsert by externalKey so a later echo of our own send from the platform
  // doesn't create a duplicate row.
  const message = externalKey
    ? await prisma.message.upsert({
        where: { externalKey },
        create: {
          conversationId: params.id,
          body: text,
          direction: "out",
          externalKey,
          createdAt,
        },
        update: {},
      })
    : await prisma.message.create({
        data: {
          conversationId: params.id,
          body: text,
          direction: "out",
        },
      });

  await prisma.conversation.update({
    where: { id: params.id },
    data: { lastMessageAt: message.createdAt, unread: 0 },
  });

  const data: MessageDTO = {
    id: message.id,
    body: message.body,
    direction: "out",
    mediaType: null,
    mediaUrl: null,
    mediaName: null,
    createdAt: message.createdAt.toISOString(),
  };

  return NextResponse.json(data);
}
