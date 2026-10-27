import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CONTROL_HISTORY_TIMEOUT_MS = Number(
  process.env.CONTROL_HISTORY_TIMEOUT_MS || 22000
);

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
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      platform: true,
      accountId: true,
      externalId: true,
      inboxCategory: true,
      contact: { select: { isGroup: true } },
      account: { select: { driver: true } },
      _count: { select: { messages: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (!conversation.externalId) {
    return NextResponse.json(
      { error: "This conversation does not have a platform chat ID to backfill." },
      { status: 409 }
    );
  }
  if (conversation.platform === "discord" && conversation.account?.driver !== "bot") {
    return NextResponse.json(
      { error: "Legacy Discord archives cannot be refreshed. Connect an official bot for live channels." },
      { status: 409 }
    );
  }

  const requestedHours = Number(req.nextUrl.searchParams.get("hours") || 0);
  const hours = Number.isFinite(requestedHours)
    ? Math.max(0, Math.min(30 * 24, requestedHours))
    : 0;
  const sinceTimestamp = hours ? Date.now() - hours * 60 * 60 * 1000 : undefined;
  const historyTimeoutMs = conversation.platform === "x" ? 125_000 : hours > 24
    ? Math.max(CONTROL_HISTORY_TIMEOUT_MS, 70_000)
    : CONTROL_HISTORY_TIMEOUT_MS;

  // A normal deep-history request starts from the oldest known message. A
  // rolling repair starts from the newest known message so WhatsApp can return
  // the recent window immediately preceding it and fill gaps in that window.
  const anchorMessage = await prisma.message.findFirst({
    where: { conversationId: conversation.id, externalKey: { not: null } },
    orderBy: { createdAt: hours ? "desc" : "asc" },
    select: { externalKey: true, createdAt: true, direction: true },
  });
  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";

  try {
    const response = await fetchWithTimeout(`${controlUrl}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: conversation.platform,
        accountId: conversation.accountId,
        chatExternalId: conversation.externalId,
        oldestMessageId: anchorMessage?.externalKey || "",
        oldestTimestamp: (anchorMessage?.createdAt || new Date()).getTime(),
        anchorFromMe: anchorMessage?.direction === "out",
        count: hours ? 500 : 200,
        isGroup: conversation.contact.isGroup,
        inboxCategory: conversation.inboxCategory,
        sinceTimestamp,
      }),
      cache: "no-store",
    }, historyTimeoutMs);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || "The sync worker could not backfill this conversation." },
        { status: response.status === 504 ? 504 : 502 }
      );
    }

    // Telegram, Gmail, X, and whatsapp-web persist before returning. Baileys
    // delivers requested history on a follow-up event, so briefly allow either
    // path to land before reporting the count to the UI.
    let afterCount = conversation._count.messages;
    const settleAttempts =
      conversation.platform === "whatsapp" && conversation.account?.driver === "baileys"
        ? 5
        : hours
          ? 2
          : 5;
    for (let attempt = 0; attempt < settleAttempts && afterCount === conversation._count.messages; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      afterCount = await prisma.message.count({ where: { conversationId: conversation.id } });
    }

    return NextResponse.json({
      ok: true,
      imported: Math.max(0, afterCount - conversation._count.messages),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        {
          error:
            "History check timed out. The chat is still usable; try the backfill again later.",
        },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "The sync worker is offline. Start it in Connections and try again." },
      { status: 503 }
    );
  }
}
