import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { MessageDTO } from "@/lib/types";
import {
  PLATFORMS,
  PLATFORM_ATTACHMENTS,
  mimeToMediaType,
  type Platform,
} from "@/lib/platforms";

export const runtime = "nodejs";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");
const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 25) * 1024 * 1024;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Opening a conversation clears its unread count and resets the cold clock…
  const conversation = await prisma.conversation.update({
    where: { id: params.id },
    data: { unread: 0, lastOpenedAt: new Date() },
    select: { platform: true, externalId: true, accountId: true },
  });

  // …and marks it read on the platform too (two-way sync), so it doesn't show
  // unread on your phone. Fire-and-forget; the worker no-ops if it can't.
  if (conversation.externalId) {
    const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
    fetch(`${controlUrl}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: conversation.platform,
        accountId: conversation.accountId,
        chatExternalId: conversation.externalId,
      }),
    }).catch(() => {});
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: params.id },
    orderBy: { createdAt: "asc" },
    include: {
      senderContact: {
        select: {
          name: true,
          avatarUrl: true,
          tags: { include: { tag: true } },
        },
      },
    },
  });

  const data: MessageDTO[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    direction: m.direction as "in" | "out",
    mediaType: (m.mediaType as MessageDTO["mediaType"]) ?? null,
    mediaUrl: m.mediaUrl ?? null,
    mediaName: m.mediaName ?? null,
    createdAt: m.createdAt.toISOString(),
    senderName: m.senderContact?.name ?? null,
    senderAvatarUrl: m.senderContact?.avatarUrl ?? null,
    senderTags: (m.senderContact?.tags ?? []).map((ct) => ({
      id: ct.tag.id,
      name: ct.tag.name,
      color: ct.tag.color,
    })),
  }));

  return NextResponse.json(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { id: true, platform: true, externalId: true, accountId: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const platform = conversation.platform as Platform;

  // Parse either a JSON text message or a multipart upload with a file.
  let text = "";
  let media:
    | { type: string; url: string; name: string }
    | undefined;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    text = String(form.get("body") || "").trim();
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
    media = { type: mediaType, url: `/media/${filename}`, name: file.name };
  } else {
    const json = await req.json();
    text = typeof json.body === "string" ? json.body.trim() : "";
  }

  if (!text && !media) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  // Real platform conversations carry an externalId — send through the sync
  // worker so the message actually leaves on Telegram/WhatsApp/X. Mock
  // conversations have no externalId and are simply stored locally.
  let externalKey: string | undefined;
  let createdAt = new Date();

  if (conversation.externalId) {
    const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
    let res: Response;
    try {
      res = await fetch(`${controlUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: conversation.platform,
          accountId: conversation.accountId,
          chatExternalId: conversation.externalId,
          text,
          media,
        }),
      });
    } catch {
      return NextResponse.json(
        { error: "Sync worker unreachable. Is `npm run sync` running?" },
        { status: 502 }
      );
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: detail.error || "Send failed on platform" },
        { status: 502 }
      );
    }
    const sent = await res.json();
    externalKey = sent.messageExternalId;
    createdAt = new Date(sent.timestamp);
  }

  const mediaData = media
    ? { mediaType: media.type, mediaUrl: media.url, mediaName: media.name }
    : {};

  // Upsert by externalKey so a later echo of our own send from the platform
  // doesn't create a duplicate row.
  const message = externalKey
    ? await prisma.message.upsert({
        where: { externalKey },
        create: {
          conversationId: params.id,
          body: text,
          direction: "out",
          externalKey,
          createdAt,
          ...mediaData,
        },
        update: {},
      })
    : await prisma.message.create({
        data: {
          conversationId: params.id,
          body: text,
          direction: "out",
          ...mediaData,
        },
      });

  // You just replied → the chat is active again (clears any Done) and any
  // snooze is cleared. It moves to Cold automatically because the last message
  // is now outbound (you're waiting on them).
  await prisma.conversation.update({
    where: { id: params.id },
    data: {
      lastMessageAt: message.createdAt,
      unread: 0,
      status: "open",
      snoozedUntil: null,
    },
  });

  const data: MessageDTO = {
    id: message.id,
    body: message.body,
    direction: "out",
    mediaType: (message.mediaType as MessageDTO["mediaType"]) ?? null,
    mediaUrl: message.mediaUrl ?? null,
    mediaName: message.mediaName ?? null,
    createdAt: message.createdAt.toISOString(),
    senderName: null,
    senderAvatarUrl: null,
    senderTags: [],
  };

  return NextResponse.json(data);
}
