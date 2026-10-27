import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🔥"]);
const SUPPORTED_PLATFORMS = new Set(["telegram", "whatsapp", "discord"]);
const REACTION_TIMEOUT_MS = Number(process.env.CONTROL_REACTION_TIMEOUT_MS || 12000);

type GroupedReaction = { emoji: string; count: number; who: string[] };

function groupReactions(
  rows: { emoji: string; count: number; actorName: string | null }[]
): GroupedReaction[] {
  const grouped = new Map<string, GroupedReaction>();
  for (const row of rows) {
    const entry = grouped.get(row.emoji) || {
      emoji: row.emoji,
      count: 0,
      who: [],
    };
    entry.count += row.count;
    if (row.actorName) entry.who.push(row.actorName);
    grouped.set(row.emoji, entry);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
  const body = (await request.json().catch(() => ({}))) as {
    emoji?: unknown;
    remove?: unknown;
  };
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const remove = body.remove === true;
  if (!REACTION_EMOJIS.has(emoji)) {
    return NextResponse.json({ error: "Choose a supported reaction." }, { status: 400 });
  }

  const message = await prisma.message.findFirst({
    where: { id: params.messageId, conversationId: params.id },
    select: {
      id: true,
      externalKey: true,
      direction: true,
      senderContact: { select: { externalKey: true } },
      conversation: {
        select: {
          platform: true,
          externalId: true,
          accountId: true,
          account: { select: { driver: true } },
        },
      },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const conversation = message.conversation;
  if (!SUPPORTED_PLATFORMS.has(conversation.platform)) {
    return NextResponse.json(
      { error: `${conversation.platform} reactions are not available yet.` },
      { status: 409 }
    );
  }
  if (
    conversation.platform === "discord" &&
    conversation.account?.driver !== "bot"
  ) {
    return NextResponse.json(
      { error: "Legacy Discord archives cannot send reactions." },
      { status: 409 }
    );
  }
  if (!conversation.externalId || !message.externalKey) {
    return NextResponse.json(
      { error: "This message does not have a platform ID to react to." },
      { status: 409 }
    );
  }

  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  try {
    const response = await fetchWithTimeout(
      `${controlUrl}/react`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: conversation.platform,
          accountId: conversation.accountId,
          chatExternalId: conversation.externalId,
          messageExternalId: message.externalKey,
          emoji,
          remove,
          fromMe: message.direction === "out",
          senderExternalKey: message.senderContact?.externalKey,
        }),
        cache: "no-store",
      },
      REACTION_TIMEOUT_MS
    );
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || "The connected account could not send that reaction." },
        { status: response.status === 504 ? 504 : response.status === 503 ? 503 : 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.name === "AbortError"
            ? "Reaction timed out. Check the native app before trying again."
            : "The sync worker is offline. Start it in Connections and try again.",
      },
      { status: error instanceof Error && error.name === "AbortError" ? 504 : 503 }
    );
  }

  if (remove) {
    await prisma.reaction.deleteMany({
      where: { messageId: message.id, actorKey: "me", emoji },
    });
  } else {
    await prisma.$transaction(async (tx) => {
      if (conversation.platform === "telegram" || conversation.platform === "whatsapp") {
        await tx.reaction.deleteMany({
          where: { messageId: message.id, actorKey: "me" },
        });
      }
      await tx.reaction.upsert({
        where: {
          messageId_actorKey_emoji: {
            messageId: message.id,
            actorKey: "me",
            emoji,
          },
        },
        create: {
          messageId: message.id,
          actorKey: "me",
          actorName: "You",
          emoji,
        },
        update: { actorName: "You", count: 1 },
      });
    });
  }

  const reactions = await prisma.reaction.findMany({
    where: { messageId: message.id },
    select: { emoji: true, count: true, actorName: true },
  });
  return NextResponse.json({ ok: true, reactions: groupReactions(reactions) });
}
