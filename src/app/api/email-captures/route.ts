import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { emailsIn } from "@/lib/email";

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("contactId");
  const query = req.nextUrl.searchParams.get("query")?.trim().toLowerCase() || "";

  if (query) {
    const [matchedCaptures, matchedMessages, matchedContacts] =
      await Promise.all([
        prisma.emailCapture.findMany({
          where: { email: { contains: query } },
          orderBy: { copiedAt: "desc" },
          take: 50,
          include: {
            contact: { select: { name: true, handle: true, avatarUrl: true } },
            conversation: { select: { platform: true } },
            message: { select: { body: true, createdAt: true } },
          },
        }),
        prisma.message.findMany({
          where: { body: { contains: query } },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            conversation: {
              select: {
                id: true,
                platform: true,
                contact: { select: { id: true, name: true, handle: true, avatarUrl: true } },
              },
            },
          },
        }),
        prisma.contact.findMany({
          where: { email: { contains: query } },
          take: 50,
          include: {
            conversations: { orderBy: { lastMessageAt: "desc" }, take: 1 },
          },
        }),
      ]);

    const results = [...matchedCaptures];
    const seen = new Set(results.map((item) => `${item.conversationId}:${item.email}`));
    const add = (item: {
      id: string; email: string; messageId: string; conversationId: string;
      contactId: string; copyCount: number; firstCopiedAt: Date; copiedAt: Date; sourceApp: string | null;
      contact: { name: string; handle: string; avatarUrl: string | null };
      conversation: { platform: string }; message: { body: string; createdAt: Date };
    }) => {
      const key = `${item.conversationId}:${item.email}`;
      if (!seen.has(key)) { seen.add(key); results.push(item); }
    };
    for (const message of matchedMessages) {
      for (const email of emailsIn(message.body).filter((email) => email.includes(query))) add({
        id: `found:${message.id}:${email}`,
        email,
        messageId: message.id,
        conversationId: message.conversation.id,
        contactId: message.conversation.contact.id,
        copyCount: 0,
        firstCopiedAt: message.createdAt,
        copiedAt: message.createdAt,
        sourceApp: null,
        contact: message.conversation.contact,
        conversation: { platform: message.conversation.platform },
        message: { body: message.body, createdAt: message.createdAt },
      });
    }
    for (const contact of matchedContacts) {
      const conversation = contact.conversations[0];
      if (!contact.email || !conversation) continue;
      add({
        id: `contact:${contact.id}:${contact.email}`,
        email: contact.email,
        messageId: "",
        conversationId: conversation.id,
        contactId: contact.id,
        copyCount: 0,
        firstCopiedAt: conversation.lastMessageAt,
        copiedAt: conversation.lastMessageAt,
        sourceApp: null,
        contact: { name: contact.name, handle: contact.handle, avatarUrl: contact.avatarUrl },
        conversation: { platform: conversation.platform },
        message: { body: "Contact email", createdAt: conversation.lastMessageAt },
      });
    }
    return NextResponse.json(results);
  }

  const captures = await prisma.emailCapture.findMany({
    where: contactId ? { contactId } : undefined,
    orderBy: { copiedAt: "desc" },
    take: 100,
    include: {
      contact: { select: { name: true, handle: true, avatarUrl: true } },
      conversation: { select: { platform: true } },
      message: { select: { body: true, createdAt: true } },
    },
  });
  // Include historical email mentions as a backfill. This applies to both the
  // global finder and a specific contact/profile so newly recovered group
  // history exposes its emails without requiring another manual copy.
  const historical = await prisma.message.findMany({
    where: {
      body: { contains: "@" },
      ...(contactId ? { conversation: { contactId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 750,
    include: {
      conversation: {
        select: {
          id: true,
          platform: true,
          contact: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        },
      },
    },
  });
  const seen = new Set(captures.map((capture) => `${capture.messageId}:${capture.email}`));
  const discoveries = historical.flatMap((message) =>
    emailsIn(message.body)
      .filter((email) => !seen.has(`${message.id}:${email}`))
      .map((email) => ({
        id: `found:${message.id}:${email}`,
        email,
        messageId: message.id,
        conversationId: message.conversation.id,
        contactId: message.conversation.contact.id,
        copyCount: 0,
        firstCopiedAt: message.createdAt,
        sourceApp: null,
        copiedAt: message.createdAt,
        contact: message.conversation.contact,
        conversation: { platform: message.conversation.platform },
        message: { body: message.body, createdAt: message.createdAt },
      }))
  );
  return NextResponse.json([...captures, ...discoveries]);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body.email || "").trim().toLowerCase();
  const messageId = String(body.messageId || "");
  const conversationId = String(body.conversationId || "");
  if (!emailsIn(email).includes(email) || !messageId || !conversationId) {
    return NextResponse.json({ error: "Invalid email capture" }, { status: 400 });
  }

  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    include: { conversation: { select: { contactId: true } } },
  });
  if (!message || !emailsIn(message.body).includes(email)) {
    return NextResponse.json({ error: "Email was not found in that message" }, { status: 400 });
  }

  const capture = await prisma.emailCapture.upsert({
    where: { messageId_email: { messageId, email } },
    create: { email, messageId, conversationId, contactId: message.conversation.contactId },
    update: { copiedAt: new Date(), copyCount: { increment: 1 } },
  });
  await prisma.contact.updateMany({
    where: { id: message.conversation.contactId, OR: [{ email: null }, { email: "" }] },
    data: { email },
  });
  return NextResponse.json(capture);
}
