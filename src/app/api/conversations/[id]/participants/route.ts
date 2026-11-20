import { NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { getCurrentUser } from "@/lib/currentUser";
import { sameSetupOrigin } from "@/lib/setup-origin";
import { groupContactScope, groupMemberPolicy, groupSourceUrl, type MemberCandidate } from "@/lib/group-membership";
import type { Platform } from "@/lib/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (request.headers.get("x-tmd-guest") === "1") return json({ error: "Owner access required." }, 403);
  await prismaReady;
  const user = await getCurrentUser();
  const chat = await prisma.conversation.findFirst({ where: { id: params.id, account: { userId: user.id }, contact: { isGroup: true } }, include: { account: true, contact: true } });
  if (!chat?.accountId || !chat.account || !chat.externalId || chat.platform !== chat.account.platform) return json({ error: "Group not found in this workspace." }, 404);
  const platform = chat.platform as Platform;
  const policy = groupMemberPolicy(platform);
  if (!policy) return json({ error: "Unsupported platform." }, 400);
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 100);
  const contactWhere = { ...groupContactScope(chat.accountId, platform), ...(q ? { AND: [{ OR: [{ name: { contains: q } }, { handle: { contains: q } }, { phone: { contains: q } }] }] } : {}) };
  const select = { id: true, name: true, handle: true, avatarUrl: true, externalKey: true };
  const [direct, senders] = await Promise.all([
    prisma.conversation.findMany({ where: { accountId: chat.accountId, platform, contact: contactWhere }, orderBy: { lastMessageAt: "desc" }, take: 60, select: { lastMessageAt: true, contact: { select } } }),
    prisma.message.findMany({ where: { conversation: { accountId: chat.accountId, platform }, senderContact: contactWhere }, distinct: ["senderContactId"], orderBy: { createdAt: "desc" }, take: 60, select: { createdAt: true, senderContact: { select } } }),
  ]);
  const candidates = new Map<string, MemberCandidate>();
  for (const row of [...direct.map(r => ({ contact: r.contact, date: r.lastMessageAt })), ...senders.map(r => ({ contact: r.senderContact, date: r.createdAt }))].sort((a, b) => b.date.getTime() - a.date.getTime())) {
    if (row.contact?.externalKey && !candidates.has(row.contact.id)) candidates.set(row.contact.id, { ...row.contact, externalKey: row.contact.externalKey, lastMessageAt: row.date.toISOString() });
  }
  return json({ policy, accountLabel: chat.account.label || platform, groupName: chat.contact.name, sourceUrl: groupSourceUrl(platform, chat.externalId), candidates: [...candidates.values()].slice(0, 60) });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!sameSetupOrigin(request) || request.headers.get("x-omni-group-action") !== "1" || request.headers.get("x-tmd-guest") === "1") return json({ error: "Group actions must come from your workspace." }, 403);
  const raw = await request.text();
  if (raw.length > 12_000) return json({ error: "Too many people selected." }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: "Invalid request." }, 400); }
  if (!input || !["resolve", "add"].includes(input.action)) return json({ error: "Choose a group action." }, 400);
  await prismaReady;
  const user = await getCurrentUser();
  try {
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/group/members/${input.action}`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(65_000),
      body: JSON.stringify({ conversationId: params.id, userId: user.id, target: input.target, requestId: input.requestId, selections: input.selections }),
    });
    return json(await response.json(), response.status);
  } catch {
    return json({ error: input.action === "resolve" ? "Could not look up this person. Check the account connection and try again." : "Could not confirm the additions. Check the group in the native app before trying again. No automatic retry was made." }, 503);
  }
}
