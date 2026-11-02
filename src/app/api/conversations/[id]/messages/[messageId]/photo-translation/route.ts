import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { sameSetupOrigin } from "@/lib/setup-origin";
import { photoTranslationService } from "@/lib/photo-translation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const translatePhoto = photoTranslationService({
  find: (conversationId, id) => prisma.message.findFirst({ where: { id, conversationId, deletedAt: null },
    select: { id: true, conversationId: true, mediaType: true, mediaUrl: true, deletedAt: true, ocrText: true, ocrStatus: true, ocrModel: true } }),
  save: async (photo, ocrText, ocrModel) => (await prisma.message.updateMany({
    where: { id: photo.id, conversationId: photo.conversationId, mediaUrl: photo.mediaUrl, deletedAt: null },
    data: { ocrText, ocrModel, ocrStatus: "complete", ocrError: null, ocrUpdatedAt: new Date() },
  })).count === 1,
});

export async function POST(request: NextRequest, { params }: { params: { id: string; messageId: string } }) {
  const host = request.headers.get("host") || new URL(request.url).host;
  let local = false;
  try { local = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${host}`).hostname); } catch { /* invalid */ }
  if (!local || process.env.MARKETING_ONLY === "1" || request.headers.get("x-omni-photo-translation") !== "1" || !sameSetupOrigin(request)) {
    return NextResponse.json({ error: "Photo translation is only available from your local workspace." }, { status: 403 });
  }
  const input = await request.json().catch(() => null);
  if (!input || !["recognize", "translate"].includes(input.action)) return NextResponse.json({ error: "Choose Read photo or Translate photo." }, { status: 400 });
  try {
    await prismaReady;
    const result = await translatePhoto(params.id, params.messageId, input.action);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Local photo translation failed. Please retry." },
      { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
}
