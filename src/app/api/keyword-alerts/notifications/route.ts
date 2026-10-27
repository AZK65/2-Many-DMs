import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { KeywordNotificationDTO } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function phrasesFromJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((phrase): phrase is string => typeof phrase === "string")
      : [];
  } catch {
    return [];
  }
}

// Materialize new matches before returning the notification feed. This keeps
// the sync worker independent from UI concerns while still making the feed
// durable and deduplicated in the database.
async function materializeKeywordHits() {
  const scanStartedAt = new Date();
  const alerts = await prisma.keywordAlert.findMany({
    where: { enabled: true },
    orderBy: [{ conversationId: "desc" }, { createdAt: "asc" }],
  });
  if (!alerts.length) return;

  const earliest = alerts.reduce(
    (date, alert) => {
      const cursor = alert.lastScannedAt ?? alert.createdAt;
      return cursor < date ? cursor : date;
    },
    alerts[0].lastScannedAt ?? alerts[0].createdAt,
  );
  const messages = await prisma.message.findMany({
    where: {
      direction: "in",
      createdAt: { gte: earliest, lte: scanStartedAt },
      conversation: {
        platform: "telegram",
        contact: { isGroup: true },
      },
    },
    select: { id: true, body: true, conversationId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const hits: Array<{ alertId: string; messageId: string; matchedPhrase: string }> = [];
  for (const message of messages) {
    const body = message.body.toLocaleLowerCase();
    const candidates = alerts.filter(
      (alert) =>
        (alert.conversationId === message.conversationId ||
          alert.conversationId === null) &&
        message.createdAt >= (alert.lastScannedAt ?? alert.createdAt),
    );
    for (const alert of candidates) {
      const phrase = phrasesFromJson(alert.phrases).find((candidate) =>
        body.includes(candidate.toLocaleLowerCase()),
      );
      if (!phrase) continue;
      hits.push({ alertId: alert.id, messageId: message.id, matchedPhrase: phrase });
      break;
    }
  }

  for (const hit of hits) {
    await prisma.keywordAlertHit.upsert({
      where: { messageId: hit.messageId },
      create: hit,
      update: {
        alertId: hit.alertId,
        matchedPhrase: hit.matchedPhrase,
      },
    });
  }
  await prisma.keywordAlert.updateMany({
    where: { id: { in: alerts.map((alert) => alert.id) } },
    data: { lastScannedAt: scanStartedAt },
  });
}

export async function GET() {
  await materializeKeywordHits();
  const hits = await prisma.keywordAlertHit.findMany({
    include: {
      message: {
        select: {
          body: true,
          createdAt: true,
          conversationId: true,
          senderContact: { select: { name: true } },
          conversation: { select: { contact: { select: { name: true } } } },
        },
      },
    },
    orderBy: { message: { createdAt: "desc" } },
    take: 100,
  });
  const notifications: KeywordNotificationDTO[] = hits.map((hit) => ({
    id: hit.id,
    alertId: hit.alertId,
    messageId: hit.messageId,
    conversationId: hit.message.conversationId,
    groupName: hit.message.conversation.contact.name,
    senderName: hit.message.senderContact?.name ?? null,
    preview: hit.message.body,
    matchedPhrase: hit.matchedPhrase,
    createdAt: hit.message.createdAt.toISOString(),
    readAt: hit.readAt?.toISOString() ?? null,
  }));
  return NextResponse.json(notifications, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; all?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const readAt = new Date();
  if (body.all === true) {
    await prisma.keywordAlertHit.updateMany({
      where: { readAt: null },
      data: { readAt },
    });
    return NextResponse.json({ ok: true, readAt: readAt.toISOString() });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Notification id required" }, { status: 400 });
  }
  const updated = await prisma.keywordAlertHit.update({
    where: { id: body.id },
    data: { readAt },
  });
  return NextResponse.json({ ok: true, readAt: updated.readAt?.toISOString() });
}
