import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { emailsIn } from "@/lib/email";

export async function POST(req: NextRequest) {
  const json = await req.json();
  const email = String(json.email || "").trim().toLowerCase();
  const sourceApp = String(json.sourceApp || "").trim().slice(0, 120) || null;
  if (!emailsIn(email).includes(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // SQLite's contains comparison is case-insensitive for ASCII. Validate the
  // extracted address afterward so substrings and punctuation cannot mismatch.
  const candidates = await prisma.message.findMany({
    where: { body: { contains: email } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      conversation: { select: { id: true, contactId: true, platform: true } },
    },
  });
  const matches = candidates.filter((message) => emailsIn(message.body).includes(email));

  await Promise.all(matches.map((message) =>
    prisma.emailCapture.upsert({
      where: { messageId_email: { messageId: message.id, email } },
      create: {
        email,
        messageId: message.id,
        conversationId: message.conversation.id,
        contactId: message.conversation.contactId,
        sourceApp,
      },
      update: {
        copiedAt: new Date(),
        copyCount: { increment: 1 },
        ...(sourceApp ? { sourceApp } : {}),
      },
    })
  ));

  return NextResponse.json({
    email,
    matchCount: matches.length,
    bestMatch: matches[0] ? {
      conversationId: matches[0].conversation.id,
      messageId: matches[0].id,
      platform: matches[0].conversation.platform,
    } : null,
  });
}
