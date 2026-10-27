import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const SEARCHABLE_PLATFORMS = new Set([
  "telegram",
  "whatsapp",
  "x",
  "discord",
  "gmail",
]);

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);
  if (query.length < 2) {
    return NextResponse.json({ results: [], pendingImageCount: 0 });
  }
  const requestedPlatform = request.nextUrl.searchParams.get("platform") || "";
  const platform = SEARCHABLE_PLATFORMS.has(requestedPlatform)
    ? requestedPlatform
    : null;

  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 8);
  const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim();
  const requestedOffset = Number(request.nextUrl.searchParams.get("offset") || 0);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  const [messages, pendingImageCount] = await Promise.all([
    prisma.message.findMany({
      where: {
        ...(conversationId ? { conversationId } : {}),
        ...(platform ? { conversation: { platform } } : {}),
        AND: tokens.map((token) => ({
          OR: [
            { body: { contains: token } },
            { ocrText: { contains: token } },
          ],
        })),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: 41,
      select: {
        id: true,
        conversationId: true,
        body: true,
        ocrText: true,
        mediaType: true,
        direction: true,
        createdAt: true,
        senderContact: { select: { name: true } },
      },
    }),
    prisma.message.count({
      where: {
        ...(conversationId ? { conversationId } : {}),
        mediaType: "image",
        mediaUrl: { startsWith: "/media/" },
        ...(platform ? { conversation: { platform } } : {}),
        OR: [
          { ocrStatus: null },
          { ocrStatus: { in: ["processing", "failed"] } },
        ],
      },
    }),
  ]);

  return NextResponse.json({
    hasMore: messages.length > 40,
    results: messages.slice(0, 40).map((message) => {
      const body = message.body.replace(/\s+/g, " ").trim();
      const imageText = (message.ocrText || "").replace(/\s+/g, " ").trim();
      const bodyLower = body.toLowerCase();
      const imageLower = imageText.toLowerCase();
      const bodyMatches = tokens.every((token) => bodyLower.includes(token.toLowerCase()));
      const imageMatches = tokens.some((token) => imageLower.includes(token.toLowerCase()));
      const matchSource = !bodyMatches && imageMatches ? "image" : "message";
      const sourceText = matchSource === "image" ? imageText : body;
      const firstMatch = tokens
        .map((token) => sourceText.toLowerCase().indexOf(token.toLowerCase()))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, firstMatch - 55);
      const snippet = sourceText.slice(start, start + 220).trim();

      return {
        id: message.id,
        conversationId: message.conversationId,
        body: `${start > 0 ? "…" : ""}${snippet}${start + 220 < sourceText.length ? "…" : ""}`,
        direction: message.direction,
        createdAt: message.createdAt.toISOString(),
        senderName: message.senderContact?.name ?? null,
        matchSource,
        mediaType: message.mediaType,
      };
    }),
    pendingImageCount,
  });
}
