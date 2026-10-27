import { NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import type {
  SharedContentDTO,
  SharedLinkDTO,
  SharedMessageDTO,
} from "@/lib/shared-content";
import type { MediaType } from "@/lib/types";

export const runtime = "nodejs";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function cleanUrl(url: string): string {
  return url.replace(/[),.!?\]}]+$/g, "");
}

function asSharedMessage(message: {
  id: string;
  body: string;
  direction: string;
  createdAt: Date;
  pinnedAt: Date | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
  senderContact: { name: string } | null;
}): SharedMessageDTO {
  return {
    id: message.id,
    body: message.body,
    direction: message.direction === "out" ? "out" : "in",
    createdAt: message.createdAt.toISOString(),
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
    mediaType: (message.mediaType as MediaType | null) ?? null,
    mediaUrl: message.mediaUrl,
    mediaName: message.mediaName,
    senderName: message.senderContact?.name ?? null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const includeSender = { senderContact: { select: { name: true } } } as const;
  const [pinnedRows, mediaRows, linkRows] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: params.id, pinnedAt: { not: null } },
      orderBy: { pinnedAt: "desc" },
      take: 100,
      include: includeSender,
    }),
    prisma.message.findMany({
      where: { conversationId: params.id, mediaType: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: includeSender,
    }),
    prisma.message.findMany({
      where: { conversationId: params.id, body: { contains: "http" } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        body: true,
        direction: true,
        createdAt: true,
        senderContact: { select: { name: true } },
      },
    }),
  ]);

  const links: SharedLinkDTO[] = linkRows.flatMap((message) =>
    [...message.body.matchAll(URL_PATTERN)].map((match, index) => ({
      id: `${message.id}:${index}`,
      messageId: message.id,
      url: cleanUrl(match[0]),
      body: message.body,
      direction: message.direction === "out" ? "out" : "in",
      createdAt: message.createdAt.toISOString(),
      senderName: message.senderContact?.name ?? null,
    }))
  );

  const result: SharedContentDTO = {
    pinned: pinnedRows.map(asSharedMessage),
    media: mediaRows.map(asSharedMessage),
    links,
  };
  return NextResponse.json(result);
}
