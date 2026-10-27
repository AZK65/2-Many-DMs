import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import {
  MEDIA_LABEL,
  type ConversationDTO,
  type ConversationPollDTO,
  type MediaType,
} from "@/lib/types";
import type { Platform } from "@/lib/platforms";
import { createHash } from "node:crypto";
import { groupPreviewMap } from "@/lib/group-avatar-data";

export const dynamic = "force-dynamic";

type LatestMessageRow = {
  conversationId: string;
  body: string | null;
  mediaType: string | null;
  direction: string | null;
  replyDirection: string | null;
  deliveryStatus: string | null;
  externalKey: string | null;
};

async function latestMessageMap(): Promise<Map<string, LatestMessageRow>> {
  const rows = await prisma.$queryRaw<LatestMessageRow[]>`
    SELECT
      c."id" AS "conversationId",
      m."body" AS "body",
      m."mediaType" AS "mediaType",
      m."direction" AS "direction",
      m."deliveryStatus" AS "deliveryStatus",
      m."externalKey" AS "externalKey",
      (SELECT answered."direction" FROM "Message" answered
        WHERE answered."conversationId" = c."id"
          AND (answered."direction" != 'out' OR answered."deliveryStatus" IS NULL OR answered."deliveryStatus" = 'sent')
        ORDER BY answered."createdAt" DESC LIMIT 1) AS "replyDirection"
    FROM "Conversation" c
    LEFT JOIN "Message" m ON m."id" = (
      SELECT m2."id"
      FROM "Message" m2
      WHERE m2."conversationId" = c."id"
      ORDER BY m2."createdAt" DESC
      LIMIT 1
    )
  `;
  return new Map(rows.map((row) => [row.conversationId, row]));
}

function latestPreview(last: LatestMessageRow | undefined): string | null {
  if (!last) return null;
  return (
    last.body ||
    (last.mediaType ? MEDIA_LABEL[last.mediaType as MediaType] : null)
  );
}

function jsonResponse<T>(req: NextRequest, data: T): NextResponse {
  const json = JSON.stringify(data);
  const etag = `"${createHash("sha1").update(json).digest("base64url")}"`;
  if (req.headers.get("if-none-match") === etag)
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  return new NextResponse(json, {
    headers: {
      "Content-Type": "application/json",
      ETag: etag,
      "Cache-Control": "no-cache",
    },
  });
}

export async function GET(req: NextRequest) {
  await prismaReady;

  if (req.nextUrl.searchParams.get("appearance") === "1") {
    const [conversations, groups] = await Promise.all([
      prisma.conversation.findMany({
        orderBy: { id: "asc" },
        select: { id: true, contact: { select: { avatarUrl: true, isGroup: true } } },
      }),
      groupPreviewMap(),
    ]);
    return jsonResponse(req, conversations.map(c => ({
      id: c.id, avatarUrl: c.contact.avatarUrl,
      groupPreview: c.contact.isGroup ? groups.get(c.id) ?? { count: 0, members: [] } : null,
    })));
  }

  if (req.nextUrl.searchParams.get("poll") === "1") {
    const [conversations, latestByConversation] = await Promise.all([
      prisma.conversation.findMany({
        orderBy: { lastMessageAt: "desc" },
        select: {
          id: true,
          unread: true,
          hasUnreadMention: true,
          lastMessageAt: true,
          archived: true,
          inboxCategory: true,
          status: true,
          followUpAt: true,
          snoozedUntil: true,
          lastOpenedAt: true,
        },
      }),
      latestMessageMap(),
    ]);
    const data: ConversationPollDTO[] = conversations.map((conversation) => {
      const last = latestByConversation.get(conversation.id);
      return {
        ...conversation,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        lastMessage: latestPreview(last),
        lastMessageDelivery: last?.deliveryStatus,
        previewOnly: last?.externalKey?.startsWith("x:preview:") || false,
        inboxCategory: conversation.inboxCategory as ConversationPollDTO["inboxCategory"],
        status: conversation.status as ConversationPollDTO["status"],
        followUpAt: conversation.followUpAt?.toISOString() ?? null,
        snoozedUntil: conversation.snoozedUntil?.toISOString() ?? null,
        lastOpenedAt: conversation.lastOpenedAt?.toISOString() ?? null,
        lastDirection:
          last?.replyDirection === "in" || last?.replyDirection === "out"
            ? last.replyDirection
            : null,
      };
    });
    return jsonResponse(req, data);
  }

  const [conversations, latestByConversation, groups] = await Promise.all([
    prisma.conversation.findMany({
      orderBy: { lastMessageAt: "desc" },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        folders: { select: { folderId: true } },
        account: { select: { id: true, label: true, driver: true, status: true } },
      },
    }),
    latestMessageMap(),
    groupPreviewMap(),
  ]);

  const data: ConversationDTO[] = conversations.map((c) => {
    const last = latestByConversation.get(c.id);
    return {
      id: c.id,
      platform: c.platform as Platform,
      externalId: c.externalId,
      unread: c.unread,
      hasUnreadMention: c.hasUnreadMention,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessage: latestPreview(last),
      lastMessageDelivery: last?.deliveryStatus,
      previewOnly: last?.externalKey?.startsWith("x:preview:") || false,
      pinned: c.pinned,
      hidden: c.hidden,
      archived: c.archived,
      inboxCategory: c.inboxCategory as ConversationDTO["inboxCategory"],
      status: c.status as ConversationDTO["status"],
      intent: c.intent as ConversationDTO["intent"],
      followUpAt: c.followUpAt ? c.followUpAt.toISOString() : null,
      snoozedUntil: c.snoozedUntil ? c.snoozedUntil.toISOString() : null,
      lastOpenedAt: c.lastOpenedAt ? c.lastOpenedAt.toISOString() : null,
      priority: c.priority,
      todo: c.todo,
      todoNote: c.todoNote,
      todoCompleted: c.todoCompleted,
      todoAddedAt: c.todoAddedAt ? c.todoAddedAt.toISOString() : null,
      translationEnabled: c.translationEnabled,
      translationLanguageCode: c.translationLanguageCode,
      translationLanguageName: c.translationLanguageName,
      lastDirection:
        last?.replyDirection === "in" || last?.replyDirection === "out"
          ? last.replyDirection
          : null,
      folderIds: c.folders.map((f) => f.folderId),
      account: c.account
        ? {
            id: c.account.id,
            label: c.account.label,
            driver: c.account.driver,
            status: c.account.status,
          }
        : null,
      isGroup: c.contact.isGroup,
      groupPreview: c.contact.isGroup ? groups.get(c.id) ?? { count: 0, members: [] } : null,
      topicOf: /__t\d+$/.test(c.externalId ?? "")
        ? (c.externalId as string).replace(/__t\d+$/, "")
        : null,
      contact: {
        id: c.contact.id,
        name: c.contact.name,
        handle: c.contact.handle,
        company: c.contact.company,
        email: c.contact.email,
        phone: c.contact.phone,
        notes: c.contact.notes,
        stage: c.contact.stage,
        avatarUrl: c.contact.avatarUrl,
        tags: c.contact.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
      },
    };
  });

  return jsonResponse(req, data);
}
