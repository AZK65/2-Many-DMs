import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { clientIp, getCurrentUser } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveResponse = {
  chatExternalId?: string;
  externalKey?: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  error?: string;
};

const SUPPORTED_PLATFORMS = new Set(["telegram", "whatsapp"]);

export async function POST(req: NextRequest) {
  await prismaReady;
  const user = await getCurrentUser(clientIp(req));
  const { platform, accountId, target } = (await req
    .json()
    .catch(() => ({}))) as {
    platform?: string;
    accountId?: string;
    target?: string;
  };

  if (
    !platform ||
    !SUPPORTED_PLATFORMS.has(platform) ||
    !accountId ||
    !target?.trim()
  ) {
    return NextResponse.json(
      { error: "Choose Telegram or WhatsApp, an account, and a recipient." },
      { status: 400 }
    );
  }

  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: user.id, platform },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "That connected account is not available." },
      { status: 404 }
    );
  }

  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  let response: Response;
  try {
    response = await fetch(`${controlUrl}/conversation/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, accountId: account.id, target: target.trim() }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return NextResponse.json(
      { error: "The messaging connection is unavailable. Reconnect it and try again." },
      { status: 502 }
    );
  }

  const resolved = (await response.json().catch(() => ({}))) as ResolveResponse;
  if (
    !response.ok ||
    !resolved.chatExternalId ||
    !resolved.externalKey ||
    !resolved.name ||
    !resolved.handle
  ) {
    return NextResponse.json(
      { error: resolved.error || "That recipient could not be found." },
      { status: response.status === 400 ? 400 : 502 }
    );
  }

  const contact = await prisma.contact.upsert({
    where: { externalKey: resolved.externalKey },
    create: {
      externalKey: resolved.externalKey,
      name: resolved.name,
      handle: resolved.handle,
      avatarUrl: resolved.avatarUrl || null,
      isGroup: false,
    },
    update: {
      name: resolved.name,
      handle: resolved.handle,
      ...(resolved.avatarUrl ? { avatarUrl: resolved.avatarUrl } : {}),
    },
    select: { id: true },
  });

  const existing = await prisma.conversation.findUnique({
    where: {
      accountId_externalId: {
        accountId: account.id,
        externalId: resolved.chatExternalId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.conversation.update({
      where: { id: existing.id },
      data: { hidden: false, contactId: contact.id },
    });
    return NextResponse.json({ conversationId: existing.id, created: false });
  }

  const conversation = await prisma.conversation.create({
    data: {
      platform,
      accountId: account.id,
      externalId: resolved.chatExternalId,
      contactId: contact.id,
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });

  return NextResponse.json({ conversationId: conversation.id, created: true });
}
