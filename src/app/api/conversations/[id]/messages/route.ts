import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Message as PrismaMessage } from "@prisma/client";
import { prisma, prismaReady } from "@/lib/db";
import type { MessageDTO, MediaType } from "@/lib/types";
import {
  PLATFORMS,
  PLATFORM_ATTACHMENTS,
  mimeToMediaType,
  type Platform,
} from "@/lib/platforms";
import { translateText } from "@/lib/translation";
import { parseDeliveryIds } from "@/lib/message-delivery";

export const runtime = "nodejs";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 25) * 1024 * 1024;
const CONTROL_SEND_TIMEOUT_MS = Number(process.env.CONTROL_SEND_TIMEOUT_MS || 14000);

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Collapse reaction rows into one entry per emoji, summing aggregate counts. */
function groupReactions(
  rows: { emoji: string; count: number; actorKey: string; actorName: string | null }[]
): { emoji: string; count: number; who: string[] }[] {
  const byEmoji = new Map<string, { emoji: string; count: number; who: string[] }>();
  for (const r of rows) {
    const entry = byEmoji.get(r.emoji) || { emoji: r.emoji, count: 0, who: [] };
    entry.count += r.count;
    if (r.actorName) entry.who.push(r.actorName);
    byEmoji.set(r.emoji, entry);
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}

function outgoingMessageDTO(message: PrismaMessage): MessageDTO {
  return {
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    mutationState: message.mutationState,
    id: message.id,
    externalKey: message.externalKey,
    body: message.body,
    originalBody: message.originalBody,
    translatedBody: message.translatedBody,
    translationSourceLanguage: message.translationSourceLanguage,
    translationTargetLanguage: message.translationTargetLanguage,
    direction: "out",
    mediaType: (message.mediaType as MessageDTO["mediaType"]) ?? null,
    mediaUrl: message.mediaUrl ?? null,
    mediaName: message.mediaName ?? null,
    mediaIsGif: message.mediaIsGif,
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    replyToExternalKey: message.replyToExternalKey,
    replyPreview: message.replyPreview,
    replySender: message.replySender,
    deliveryStatus: (message.deliveryStatus as MessageDTO["deliveryStatus"]) ??
      (message.externalKey ? "sent" : undefined),
    deliveryError: message.deliveryError,
    senderContactId: null,
    senderHandle: null,
    senderExternalKey: null,
    senderName: null,
    senderAvatarUrl: null,
    senderTags: [],
    reactions: [],
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const guest = req.headers.get("x-tmd-guest") === "1";
  const markRead = !guest && req.nextUrl.searchParams.get("markRead") === "1";
  const conversation = !markRead
    ? await prisma.conversation.findUniqueOrThrow({
        where: { id: params.id },
        select: {
          platform: true,
          externalId: true,
          accountId: true,
          inboxCategory: true,
        },
      })
    : await prisma.conversation.update({
        where: { id: params.id },
        data: {
          unread: 0,
          hasUnreadMention: false,
          lastOpenedAt: new Date(),
        },
        select: {
          platform: true,
          externalId: true,
          accountId: true,
          inboxCategory: true,
        },
      });

  // …and marks it read on the platform too (two-way sync), so it doesn't show
  // unread on your phone. Fire-and-forget; the worker no-ops if it can't.
  if (markRead && conversation.externalId) {
    const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
    fetch(`${controlUrl}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: conversation.platform,
        accountId: conversation.accountId,
        chatExternalId: conversation.externalId,
        inboxCategory: conversation.inboxCategory,
      }),
    }).catch(() => {});
  }

  const after = req.nextUrl.searchParams.get("after");
  const before = req.nextUrl.searchParams.get("before");
  const focus = req.nextUrl.searchParams.get("focus");
  const focusExternalKey = req.nextUrl.searchParams.get("focusExternalKey");
  const limit = Math.min(
    100,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 75)
  );
  const expiredPendingBefore = new Date(Date.now() - 45_000);
  const focusedMessage = focus || focusExternalKey
    ? await prisma.message.findFirst({
        where: {
          conversationId: params.id,
          ...(focus ? { id: focus } : { externalKey: focusExternalKey! }),
        },
        select: { id: true, createdAt: true },
      })
    : null;
  const messages = await prisma.message.findMany({
    where: {
      conversationId: params.id,
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      ...(!after && !before && focusedMessage
        ? { createdAt: { lte: focusedMessage.createdAt } }
        : {}),
    },
    orderBy: { createdAt: after ? "asc" : "desc" },
    take: limit + 1,
    include: {
      senderContact: {
        select: {
          id: true,
          name: true,
          handle: true,
          externalKey: true,
          avatarUrl: true,
          tags: { include: { tag: true } },
        },
      },
      reactions: true,
    },
  });

  const hasMore = messages.length > limit;
  const page = messages.slice(0, limit);
  if (!after) page.reverse();
  const mentionIds = [...new Set(page.flatMap((message) =>
    [...message.body.matchAll(/@(\d{8,})/g)].map((match) => match[1])
  ))];
  const mentionedContacts = mentionIds.length
    ? await prisma.contact.findMany({
        where: {
          OR: mentionIds.flatMap((id) => [
            { externalKey: `whatsapp:${id}@lid` },
            { externalKey: `whatsapp:${id}@s.whatsapp.net` },
            { externalKey: `whatsapp:${id}@c.us` },
          ]),
        },
        select: { name: true, externalKey: true },
      })
    : [];
  const mentionNames = new Map(
    mentionedContacts.flatMap((contact) => {
      const id = contact.externalKey?.match(/^whatsapp:(\d+)@/)?.[1];
      return id && contact.name && contact.name !== id ? [[id, contact.name] as const] : [];
    })
  );
  const mentionTargets = new Map(
    mentionedContacts.flatMap((contact) => {
      const id = contact.externalKey?.match(/^whatsapp:(\d+)@/)?.[1];
      const target = contact.externalKey?.replace(/^whatsapp:/, "");
      return id && target ? [[id, target] as const] : [];
    })
  );
  const data: MessageDTO[] = page.map((m) => {
    // Keep GET read-only. Previously every 2.5-second refresh opened a write
    // transaction just to age pending delivery labels, which competed with the
    // sync worker. The worker can still promote a late platform echo to sent.
    const expiredPending =
      m.direction === "out" &&
      m.deliveryStatus === "pending" &&
      !!m.lastSendAttemptAt &&
      m.lastSendAttemptAt < expiredPendingBefore;
    return {
      editedAt: m.editedAt?.toISOString() ?? null,
      deletedAt: m.deletedAt?.toISOString() ?? null,
      mutationState: m.mutationState,
      id: m.id,
      externalKey: m.externalKey,
      body: m.body,
      originalBody: m.originalBody,
      translatedBody: m.translatedBody,
      translationSourceLanguage: m.translationSourceLanguage,
      translationTargetLanguage: m.translationTargetLanguage,
      direction: m.direction as "in" | "out",
      mediaType: (m.mediaType as MessageDTO["mediaType"]) ?? null,
      mediaUrl: m.mediaUrl ?? null,
      mediaName: m.mediaName ?? null,
      mediaIsGif: m.mediaIsGif,
      pinnedAt: m.pinnedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      replyToExternalKey: m.replyToExternalKey,
      replyPreview: m.replyPreview,
      replySender: m.replySender,
      deliveryStatus: expiredPending
        ? "unconfirmed"
        : m.direction === "out"
          ? ((m.deliveryStatus as MessageDTO["deliveryStatus"]) ??
            (m.externalKey ? "sent" : undefined))
          : undefined,
      deliveryError: expiredPending
        ? "The platform did not confirm delivery. Check the native app before retrying."
        : m.deliveryError,
      senderContactId: m.senderContact?.id ?? null,
      senderHandle: m.senderContact?.handle ?? null,
      senderExternalKey: m.senderContact?.externalKey ?? null,
      senderName: m.senderContact?.name ?? null,
      senderAvatarUrl: m.senderContact?.avatarUrl ?? null,
      senderTags: (m.senderContact?.tags ?? []).map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
      reactions: groupReactions(m.reactions),
      mentionNames: Object.fromEntries(
        [...m.body.matchAll(/@(\d{8,})/g)]
          .map((match) => [match[1], mentionNames.get(match[1])])
          .filter((entry): entry is [string, string] => !!entry[1])
      ),
      mentionTargets: Object.fromEntries(
        [...m.body.matchAll(/@(\d{8,})/g)]
          .map((match) => [match[1], mentionTargets.get(match[1])])
          .filter((entry): entry is [string, string] => !!entry[1])
      ),
    };
  });

  // Resolve exact outgoing IDs independently of pagination. Busy group chats
  // can move a pending send outside the newest window before its receipt arrives.
  const deliveryMessageIds = parseDeliveryIds(req.nextUrl.searchParams.get("deliveryIds"));
  // Reconciliation can remove a generated preview after its native copy was
  // already visible. Tell this client which of its observed IDs truly vanished;
  // absence from the newest page alone is NOT evidence of deletion.
  const observedIds = parseDeliveryIds(req.nextUrl.searchParams.get("observedIds"));
  const observedRows = observedIds.length ? await prisma.message.findMany({
    where: { conversationId: params.id, id: { in: observedIds } }, select: { id: true },
  }) : [];
  const presentIds = new Set(observedRows.map(message => message.id));
  const deliveries = deliveryMessageIds.length ? await prisma.message.findMany({
    where: { conversationId: params.id, direction: "out", id: { in: deliveryMessageIds } },
  }) : [];
  // Only refresh requested attachments from this exact conversation. These
  // compact receipts cover downloads that finish outside the newest page.
  const mediaIds = parseDeliveryIds(req.nextUrl.searchParams.get("mediaIds"));
  const mediaUpdates = mediaIds.length ? await prisma.message.findMany({
    where: { conversationId: params.id, id: { in: mediaIds }, mediaUrl: { not: null }, deletedAt: null },
    select: { id: true, externalKey: true, mediaType: true, mediaUrl: true, mediaName: true,
      mediaIsGif: true, editedAt: true, deletedAt: true },
  }) : [];
  return NextResponse.json({
    messages: data,
    mediaUpdates,
    missingObservedIds: observedIds.filter(id => !presentIds.has(id)),
    deliveries: deliveries.map(message => {
      const dto = outgoingMessageDTO(message);
      if (message.deliveryStatus === "pending" && message.lastSendAttemptAt &&
          message.lastSendAttemptAt < expiredPendingBefore) {
        dto.deliveryStatus = "unconfirmed";
        dto.deliveryError = "The platform did not confirm delivery. Check the native app before retrying.";
      }
      return dto;
    }),
    hasMore: !after && hasMore,
    focusedMessageId: focusedMessage?.id ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      contactId: true,
      platform: true,
      externalId: true,
      accountId: true,
      inboxCategory: true,
      account: { select: { driver: true } },
      translationEnabled: true,
      translationLanguageCode: true,
      translationLanguageName: true,
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const platform = conversation.platform as Platform;
  if (platform === "discord" && conversation.account?.driver !== "bot") {
    return NextResponse.json(
      {
        error:
          "This is a legacy Discord archive. Connect an official bot and reply from one of its server channels or DMs.",
      },
      { status: 409 }
    );
  }

  // Parse either a JSON text message or a multipart upload with a file.
  let text = "";
  let mentions: string[] = [];
  let replyToMessageId = "";
  let clientMessageId = "";
  let media:
    | { type: string; url: string; name: string; isGif?: boolean }
    | undefined;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    text = String(form.get("body") || "").trim();
    try {
      const rawMentions = JSON.parse(String(form.get("mentions") || "[]"));
      mentions = Array.isArray(rawMentions)
        ? rawMentions
            .filter((item: unknown): item is string => typeof item === "string")
            .slice(0, 50)
        : [];
    } catch {
      mentions = [];
    }
    replyToMessageId = String(form.get("replyToMessageId") || "");
    clientMessageId = String(form.get("clientMessageId") || "");
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    const mediaType = mimeToMediaType(file.type);
    if (!PLATFORM_ATTACHMENTS[platform].types.includes(mediaType)) {
      const noun = {
        image: "photos",
        video: "videos",
        audio: "audio",
        file: "documents",
      }[mediaType];
      return NextResponse.json(
        {
          error: `${PLATFORMS[platform].label} can't send ${noun}. ${PLATFORM_ATTACHMENTS[platform].hint}.`,
        },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File is over the size limit." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const dot = file.name.lastIndexOf(".");
    const ext =
      dot > 0
        ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "")
        : file.type.split("/")[1] || "bin";
    const filename = `out_${params.id}_${Date.now()}.${ext}`;
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buf);
    media = { type: mediaType, url: `/media/${filename}`, name: file.name, isGif: file.type === "image/gif" };
  } else {
    const json = await req.json();
    text = typeof json.body === "string" ? json.body.trim() : "";
    replyToMessageId = typeof json.replyToMessageId === "string" ? json.replyToMessageId : "";
    clientMessageId =
      typeof json.clientMessageId === "string" ? json.clientMessageId : "";
    mentions = Array.isArray(json.mentions)
      ? json.mentions.filter((item: unknown): item is string => typeof item === "string").slice(0, 50)
      : [];
    // Forwarding: re-send an existing media file (by its served path) to this
    // chat. The control server reads it off disk like any outgoing attachment.
    if (json.media?.type && json.media?.url) {
      const mtype = String(json.media.type) as MediaType;
      if (!(PLATFORM_ATTACHMENTS[platform].types as readonly string[]).includes(mtype)) {
        return NextResponse.json(
          {
            error: `${PLATFORMS[platform].label} can't receive that attachment type.`,
          },
          { status: 400 }
        );
      }
      media = {
        type: mtype,
        url: String(json.media.url),
        name: String(json.media.name || "file"),
        isGif: json.media.isGif === true,
      };
    }
  }

  if (!text && !media) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  // The browser owns this id from the optimistic render onward. Persisting the
  // same id makes the send idempotent across request retries and page refreshes.
  if (!/^client_[a-zA-Z0-9_-]{8,100}$/.test(clientMessageId)) {
    clientMessageId = `client_${randomUUID()}`;
  }
  const duplicate = await prisma.message.findUnique({
    where: { id: clientMessageId },
  });
  if (duplicate) {
    if (duplicate.conversationId !== params.id) {
      return NextResponse.json({ error: "Invalid message request id." }, { status: 409 });
    }
    const pending = ["pending", "unconfirmed"].includes(
      duplicate.deliveryStatus || ""
    );
    return NextResponse.json(
      pending
        ? {
            pending: true,
            message: outgoingMessageDTO(duplicate),
            error: duplicate.deliveryError,
          }
        : outgoingMessageDTO(duplicate),
      { status: pending ? 202 : duplicate.deliveryStatus === "failed" ? 409 : 200 }
    );
  }

  const originalText = text;
  let translationMeta: {
    originalBody?: string;
    translationSourceLanguage?: string;
    translationTargetLanguage?: string;
  } = {};
  if (
    text &&
    conversation.translationEnabled &&
    conversation.translationLanguageCode &&
    conversation.translationLanguageName
  ) {
    try {
      const recentReceiverMessages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          direction: "in",
          body: { not: "" },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { body: true },
      });
      const targetStyleSamples = recentReceiverMessages
        .map((message) => message.body.trim())
        .filter((body) => body.length >= 2 && body.length <= 240)
        .slice(0, 6);
      const translation = await translateText(
        text,
        {
          code: conversation.translationLanguageCode,
          name: conversation.translationLanguageName,
        },
        undefined,
        targetStyleSamples
      );
      text = translation.translatedText.trim();
      if (text !== originalText) {
        translationMeta = {
          originalBody: originalText,
          translationSourceLanguage: translation.detectedLanguageName,
          translationTargetLanguage: translation.targetLanguageName,
        };
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? `${error.message} Nothing was sent.`
              : "The message could not be translated. Nothing was sent.",
        },
        { status: /offline|not installed/i.test(String(error)) ? 503 : 502 }
      );
    }
  }

  const createdAt = new Date();
  const replyTarget = replyToMessageId
    ? await prisma.message.findFirst({
        where: { id: replyToMessageId, conversationId: params.id },
        include: { senderContact: { select: { name: true } } },
      })
    : null;

  const mediaData = media
    ? { mediaType: media.type, mediaUrl: media.url, mediaName: media.name, mediaIsGif: media.isGif === true }
    : {};
  const replyPreview = replyTarget
    ? replyTarget.body || (replyTarget.mediaType ? `[${replyTarget.mediaType}]` : "Message")
    : null;
  const replySender = replyTarget
    ? replyTarget.direction === "out"
      ? "You"
      : replyTarget.senderContact?.name || "Contact"
    : null;

  let message = await prisma.message.create({
    data: {
      id: clientMessageId,
      conversationId: params.id,
      body: text,
      direction: "out",
      createdAt,
      replyToExternalKey: replyTarget?.externalKey,
      replyPreview,
      replySender,
      deliveryStatus: conversation.externalId ? "pending" : "sent",
      sendAttempts: conversation.externalId ? 1 : 0,
      lastSendAttemptAt: conversation.externalId ? createdAt : null,
      ...translationMeta,
      ...mediaData,
    },
  });

  // Mock conversations are local-only and therefore confirmed immediately.
  if (!conversation.externalId) {
    await prisma.conversation.update({
      where: { id: params.id },
      data: {
        lastMessageAt: createdAt,
        unread: 0,
        hasUnreadMention: false,
        status: "open",
      },
    });
    return NextResponse.json(outgoingMessageDTO(message));
  }

  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  let res: Response;
  try {
    res = await fetchWithTimeout(`${controlUrl}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: conversation.platform,
        accountId: conversation.accountId,
        chatExternalId: conversation.externalId,
        text,
        media,
        mentions,
        replyToExternalId: replyTarget?.externalKey,
        pendingMessageId: message.id,
        waitForConfirmation: false,
        inboxCategory: conversation.inboxCategory,
      }),
      cache: "no-store",
    }, CONTROL_SEND_TIMEOUT_MS);
  } catch (error) {
    if (isAbortError(error)) {
      message = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      return NextResponse.json(
        {
          pending: true,
          message: outgoingMessageDTO(message),
          error: `${PLATFORMS[platform].label} is still checking delivery.`,
        },
        { status: 202 }
      );
    }
    // A broken response socket is not proof the worker never received the
    // request. Only a refused connection is a known pre-send failure.
    const refused = (error as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED";
    await prisma.message.updateMany({
      where: { id: message.id, deliveryStatus: "pending" },
      data: {
        deliveryStatus: refused ? "failed" : "unconfirmed",
        deliveryError: refused
          ? "The sync worker is offline. No message was sent."
          : "The connection ended before delivery was confirmed. Check the native app before retrying.",
      },
    });
    message = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    return NextResponse.json(
      { error: message.deliveryError, message: outgoingMessageDTO(message) },
      { status: message.deliveryStatus === "failed" ? 502 : 202 }
    );
  }

  if (res.status === 202) {
    // The worker can finish before its acknowledgement gets back to this route.
    // Return the latest receipt, not the original queued snapshot.
    message = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    return NextResponse.json(
      { pending: true, message: outgoingMessageDTO(message) },
      { status: 202 }
    );
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as {
      error?: string;
      uncertain?: boolean;
      accepted?: boolean;
    };
    if (res.status === 504 || detail.uncertain) {
      await prisma.message.updateMany({
        where: { id: message.id, deliveryStatus: "pending" },
        data: {
          deliveryStatus: "unconfirmed",
          deliveryError:
            "The platform did not confirm delivery. Check the native app before retrying.",
        },
      });
      message = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      return NextResponse.json(
        {
          pending: true,
          message: outgoingMessageDTO(message),
          error: message.deliveryError,
        },
        { status: 202 }
      );
    }
    const deliveryError =
      detail.accepted === false || res.status === 503
        ? `${PLATFORMS[platform].label} is reconnecting. No message was sent.`
        : (detail.error || "The platform rejected this send.").replace(/^Error:\s*/, "");
    message = await prisma.message.update({
      where: { id: message.id },
      data: { deliveryStatus: "failed", deliveryError },
    });
    return NextResponse.json(
      { error: deliveryError, message: outgoingMessageDTO(message) },
      { status: res.status === 503 ? 503 : 502 }
    );
  }

  const sent = await res.json() as { messageExternalId: string; timestamp: string };
  // The worker normally commits this before responding. Updating again is
  // idempotent and covers remote workers that do not share this database.
  message = await prisma.message.update({
    where: { id: message.id },
    data: {
      externalKey: sent.messageExternalId,
      createdAt: new Date(sent.timestamp),
      deliveryStatus: "sent",
      deliveryError: null,
    },
  });

  await prisma.conversation.update({
    where: { id: params.id },
    data: {
      lastMessageAt: message.createdAt,
      unread: 0,
      hasUnreadMention: false,
      status: "open",
      snoozedUntil: null,
      followUpAt: null,
    },
  }).catch((error) => {
    console.error("[messages] delivered but conversation summary update was delayed", error);
  });

  return NextResponse.json(outgoingMessageDTO(message));
}
