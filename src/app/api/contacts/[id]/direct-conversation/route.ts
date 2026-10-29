import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const platform = req.nextUrl.searchParams.get("platform");
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!platform) {
    return NextResponse.json({ error: "Platform is required" }, { status: 400 });
  }

  const select = {
    id: true,
    accountId: true,
    lastMessageAt: true,
    account: { select: { label: true } },
    messages: {
      orderBy: { createdAt: "desc" as const },
      take: 6,
      select: {
        id: true,
        body: true,
        direction: true,
        mediaType: true,
        mediaName: true,
        createdAt: true,
      },
    },
  };

  const where = {
    contactId: params.id,
    platform,
    contact: { isGroup: false },
  };
  const exact = accountId
    ? await prisma.conversation.findFirst({
        where: { ...where, accountId },
        orderBy: { lastMessageAt: "desc" },
        select,
      })
    : null;
  const conversation =
    exact ||
    (!accountId && await prisma.conversation.findFirst({
      where,
      orderBy: { lastMessageAt: "desc" },
      select,
    }));

  if (!conversation) return NextResponse.json({ conversation: null });

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      accountId: conversation.accountId,
      accountLabel: conversation.account?.label ?? null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      messages: conversation.messages.reverse().map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    },
  });
}
