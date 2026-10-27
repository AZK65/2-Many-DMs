import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { KeywordAlertDTO } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePhrases(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((phrase): phrase is string => typeof phrase === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizePhrases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const phrase = raw.trim().replace(/\s+/g, " ").slice(0, 100);
    const key = phrase.toLocaleLowerCase();
    if (phrase.length < 2 || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
    if (phrases.length === 30) break;
  }
  return phrases;
}

function toDTO(alert: {
  id: string;
  conversationId: string | null;
  phrases: string;
  enabled: boolean;
  updatedAt: Date;
  conversation?: { contact: { name: string } } | null;
}): KeywordAlertDTO {
  return {
    id: alert.id,
    conversationId: alert.conversationId,
    scope: alert.conversationId ? "conversation" : "all_groups",
    phrases: parsePhrases(alert.phrases),
    enabled: alert.enabled,
    groupName: alert.conversation?.contact.name ?? null,
    updatedAt: alert.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const alerts = await prisma.keywordAlert.findMany({
    where: conversationId
      ? { OR: [{ conversationId }, { conversationId: null }] }
      : undefined,
    include: { conversation: { select: { contact: { select: { name: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(alerts.map(toDTO), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const scope = body.scope === "all_groups" ? "all_groups" : "conversation";
  const conversationId =
    scope === "conversation" && typeof body.conversationId === "string"
      ? body.conversationId
      : null;
  if (scope === "conversation" && !conversationId) {
    return NextResponse.json({ error: "Choose a Telegram group" }, { status: 400 });
  }

  if (conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { platform: true, contact: { select: { isGroup: true } } },
    });
    if (!conversation || conversation.platform !== "telegram" || !conversation.contact.isGroup) {
      return NextResponse.json(
        { error: "Keyword alerts can only watch synced Telegram groups" },
        { status: 400 },
      );
    }
  }

  const phrases = normalizePhrases(body.phrases);
  const enabled = body.enabled !== false && phrases.length > 0;
  const existing = await prisma.keywordAlert.findFirst({
    where: { conversationId },
  });
  // Saving or re-enabling a rule starts a fresh watch window. Messages from a
  // period when the rule was disabled must not appear as new notifications.
  const data = {
    phrases: JSON.stringify(phrases),
    enabled,
    lastScannedAt: new Date(),
  };
  const alert = existing
    ? await prisma.keywordAlert.update({ where: { id: existing.id }, data })
    : await prisma.keywordAlert.create({ data: { ...data, conversationId } });

  const hydrated = await prisma.keywordAlert.findUniqueOrThrow({
    where: { id: alert.id },
    include: { conversation: { select: { contact: { select: { name: true } } } } },
  });
  return NextResponse.json(toDTO(hydrated));
}
