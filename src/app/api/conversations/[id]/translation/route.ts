import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import {
  detectConversationLanguage,
  translateText,
  translationEngineStatus,
} from "@/lib/translation";

export const runtime = "nodejs";

const ENGLISH = { code: "en", name: "English" };

function errorResponse(error: unknown, fallback: string, status = 502) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: {
      translationEnabled: true,
      translationLanguageCode: true,
      translationLanguageName: true,
    },
  });
  if (!conversation) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  const engine = await translationEngineStatus();
  return NextResponse.json({ ...conversation, ...engine });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const input = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    languageCode?: string | null;
    languageName?: string | null;
  };
  const existing = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      translationLanguageCode: true,
      translationLanguageName: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Chat not found." }, { status: 404 });

  const engine = await translationEngineStatus();
  if (input.enabled && !engine.available) {
    return NextResponse.json(
      { error: engine.detail },
      { status: 503 }
    );
  }

  let languageCode =
    input.languageCode === undefined
      ? existing.translationLanguageCode
      : input.languageCode?.trim().slice(0, 20) || null;
  let languageName =
    input.languageName === undefined
      ? existing.translationLanguageName
      : input.languageName?.trim().slice(0, 80) || null;

  if (input.enabled && (!languageCode || !languageName)) {
    const recent = await prisma.message.findMany({
      where: {
        conversationId: params.id,
        direction: "in",
        body: { not: "" },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { body: true },
    });
    const samples = recent
      .map((message) => message.body.trim())
      .filter((body) => body.length >= 3)
      .slice(0, 8);
    if (!samples.length) {
      return NextResponse.json(
        { error: "There are not enough received messages to detect a language. Choose one manually." },
        { status: 422 }
      );
    }
    try {
      const detected = await detectConversationLanguage(samples);
      if (detected.languageCode === "und" || detected.languageName === "Unknown") {
        return NextResponse.json(
          { error: "The receiver's language is unclear. Choose one manually." },
          { status: 422 }
        );
      }
      languageCode = detected.languageCode;
      languageName = detected.languageName;
    } catch (error) {
      return errorResponse(error, "The receiver's language could not be detected.");
    }
  }

  const updated = await prisma.conversation.update({
    where: { id: params.id },
    data: {
      translationEnabled: Boolean(input.enabled),
      translationLanguageCode: languageCode,
      translationLanguageName: languageName,
    },
    select: {
      translationEnabled: true,
      translationLanguageCode: true,
      translationLanguageName: true,
    },
  });
  return NextResponse.json({ ...updated, ...engine });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const engine = await translationEngineStatus();
  if (!engine.available) {
    return NextResponse.json(
      { error: engine.detail },
      { status: 503 }
    );
  }
  const input = (await req.json().catch(() => ({}))) as {
    messageId?: string;
    messageIds?: string[];
  };
  const requestedIds = Array.from(
    new Set(
      (input.messageIds?.length ? input.messageIds : input.messageId ? [input.messageId] : [])
        .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        .map((id) => id.trim())
    )
  ).slice(0, 8);
  if (!requestedIds.length) {
    return NextResponse.json({ error: "Choose a message to translate." }, { status: 400 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: {
      translationLanguageCode: true,
      translationLanguageName: true,
    },
  });
  if (!conversation) return NextResponse.json({ error: "Chat not found." }, { status: 404 });

  const foundMessages = await prisma.message.findMany({
    where: {
      id: { in: requestedIds },
      conversationId: params.id,
      direction: "in",
    },
    select: {
      id: true,
      body: true,
      translatedBody: true,
      translationSourceLanguage: true,
      translationTargetLanguage: true,
    },
  });

  const byId = new Map(foundMessages.map((message) => [message.id, message]));
  const sourceHint =
    conversation.translationLanguageCode && conversation.translationLanguageName
      ? {
          code: conversation.translationLanguageCode,
          name: conversation.translationLanguageName,
        }
      : undefined;
  const translated = [];
  const errors: Array<{ id: string; error: string }> = [];

  // Ollama serves one local model. Translate sequentially so opening a chat
  // never launches competing model jobs that make the whole app less responsive.
  for (const id of requestedIds) {
    const message = byId.get(id);
    if (!message) {
      errors.push({ id, error: "Message not found." });
      continue;
    }
    if (message.translatedBody) {
      translated.push(message);
      continue;
    }
    try {
      const result = await translateText(message.body, ENGLISH, sourceHint);
      translated.push(
        await prisma.message.update({
          where: { id: message.id },
          data: {
            translatedBody: result.translatedText,
            translationSourceLanguage: result.detectedLanguageName,
            translationTargetLanguage: result.targetLanguageName,
          },
          select: {
            id: true,
            translatedBody: true,
            translationSourceLanguage: true,
            translationTargetLanguage: true,
          },
        })
      );
    } catch (error) {
      errors.push({
        id,
        error: error instanceof Error ? error.message : "The message could not be translated.",
      });
    }
  }

  if (input.messageId && !input.messageIds) {
    const result = translated[0];
    if (result) return NextResponse.json(result);
    return NextResponse.json(
      { error: errors[0]?.error || "The message could not be translated." },
      { status: errors[0]?.error === "Message not found." ? 404 : 502 }
    );
  }
  return NextResponse.json({ messages: translated, errors });
}
