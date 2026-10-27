import { NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { buildPeopleNetwork } from "@/lib/people-network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prismaReady;
    const [contacts, chats, members] = await Promise.all([
      prisma.contact.findMany({
        where: { isGroup: false, OR: [{ conversations: { some: {} } }, { sentMessages: { some: { direction: "in", conversation: { contact: { isGroup: true } } } } }] },
        select: { id: true, name: true, handle: true, email: true, phone: true, externalKey: true },
      }),
      prisma.conversation.findMany({
        select: { id: true, platform: true, externalId: true, contactId: true, contact: { select: { name: true, isGroup: true } } },
      }),
      prisma.message.groupBy({
        by: ["senderContactId", "conversationId"],
        where: { direction: "in", senderContactId: { not: null }, conversation: { contact: { isGroup: true } } },
        _max: { createdAt: true },
      }),
    ]);
    const network = buildPeopleNetwork(contacts,
      chats.map(c => ({ ...c, name: c.contact.name, isGroup: c.contact.isGroup })),
      members.flatMap(m => m.senderContactId && m._max.createdAt ? [{ contactId: m.senderContactId, conversationId: m.conversationId, lastSeen: m._max.createdAt.toISOString() }] : []),
    );
    return NextResponse.json(network, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[people-network] Could not load saved connections", error);
    return NextResponse.json({ error: "Could not load connections. Please retry." }, { status: 500 });
  }
}
