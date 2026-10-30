import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { relationCandidateData } from "@/lib/relation-candidate-data";
import { findRelationCandidates } from "@/lib/relation-candidates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const query = req.nextUrl.searchParams.get("q") || "";
  const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
  const scope = req.nextUrl.searchParams.get("scope") || "suggested";
  if (!conversationId || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || !["all", "suggested"].includes(scope)) {
    return NextResponse.json({ error: "Choose a conversation and a valid search." }, { status: 400 });
  }
  try {
    await prismaReady;
    const sourceRow = await prisma.conversation.findFirst({ where: { id: conversationId, contactId: params.id }, select: { id: true } });
    if (!sourceRow) return NextResponse.json({ error: "This contact does not own that conversation." }, { status: 404 });
    const [data, relations] = await Promise.all([
      relationCandidateData(),
      prisma.contactRelation.findMany({ where: { contactId: params.id }, select: { targetConversationId: true } }),
    ]);
    const source = data.chats.find(chat => chat.id === conversationId);
    if (!source) return NextResponse.json({ error: "This chat is still loading. Please retry." }, { status: 409 });
    const result = findRelationCandidates({ ...data, source, query, offset, scope: scope as "all" | "suggested", linkedIds: relations.map(item => item.targetConversationId) });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not find related chats. Please retry." }, { status: 500 });
  }
}
