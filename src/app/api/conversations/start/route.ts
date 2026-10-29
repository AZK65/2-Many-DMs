import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { clientIp, getCurrentUser } from "@/lib/currentUser";
import { directRecipientIds, isGenericDirectIdentity, preserveDirectIdentity } from "@/lib/direct-contact-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveResponse = {
  chatExternalId?: string;
  externalKey?: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  aliases?: string[];
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

  const recipientIds = directRecipientIds(platform, resolved.chatExternalId, resolved.aliases);
  const canonicalId = recipientIds[0];
  if (!canonicalId) return NextResponse.json({ error: "That recipient could not be verified." }, { status: 502 });
  const externalKeys = recipientIds.map(id => `${platform}:${id}`);
  const result = await prisma.$transaction(async tx => {
    // Reuse real history on this sending account. A newly created empty LID
    // thread must not hide an established phone-ID thread, or another account.
    const candidates = await tx.conversation.findMany({
      where: { platform, accountId: account.id, externalId: { in: recipientIds }, contact: { isGroup: false } },
      include: { contact: true, _count: { select: { messages: true } } },
      orderBy: { lastMessageAt: "desc" },
    });
    const existing = candidates.find(candidate => candidate._count.messages > 0) ||
      candidates.find(candidate => candidate.externalId === canonicalId) || candidates[0];
    const savedContacts = await tx.contact.findMany({ where: { externalKey: { in: externalKeys }, isGroup: false } });
    const saved = existing?.contact || savedContacts.find(contact => contact.externalKey === `${platform}:${canonicalId}`) || savedContacts[0];
    const knownIdentity = saved && !isGenericDirectIdentity(saved.name) ? saved
      : savedContacts.find(contact => !isGenericDirectIdentity(contact.name)) || saved || null;
    const identity = preserveDirectIdentity(knownIdentity, { name: resolved.name!, handle: resolved.handle! });
    const phoneId = platform === "whatsapp" ? recipientIds.find(id => id.endsWith("@c.us")) : undefined;
    const data = {
      ...identity,
      ...(resolved.avatarUrl && !saved?.avatarUrl ? { avatarUrl: resolved.avatarUrl } : {}),
      ...(phoneId && !saved?.phone ? { phone: `+${phoneId.split("@")[0]}` } : {}),
    };
    const contact = saved ? await tx.contact.update({ where: { id: saved.id }, data }) : await tx.contact.create({
      data: { ...data, externalKey: `${platform}:${canonicalId}`, isGroup: false },
    });
    if (existing) {
      await tx.conversation.update({ where: { id: existing.id }, data: { hidden: false } });
      return { conversationId: existing.id, created: false };
    }
    const conversation = await tx.conversation.create({
      data: { platform, accountId: account.id, externalId: canonicalId, contactId: contact.id, lastMessageAt: new Date() },
      select: { id: true },
    });
    return { conversationId: conversation.id, created: true };
  });
  return NextResponse.json(result);
}
