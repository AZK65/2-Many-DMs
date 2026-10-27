import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { canAutoLoadMedia } from "@/lib/automatic-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function extension(value: string | null | undefined): string {
  const clean = (value || "").split(/[?#]/)[0];
  return path.extname(clean).slice(1).toLowerCase();
}

function contentType(
  mediaName: string | null,
  storedFilename: string,
  mediaType: string | null
): string {
  // WhatsApp can transcode an uploaded file (for example PNG to JPEG) while
  // retaining the sender's original filename. The stored extension describes
  // the bytes we are actually serving, so it must take precedence.
  const stored = MIME_BY_EXTENSION[extension(storedFilename)];
  if (stored) return stored;
  const named = MIME_BY_EXTENSION[extension(mediaName)];
  if (named) return named;
  if (mediaType === "image" || mediaType === "sticker") return "image/jpeg";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "audio") return "audio/mpeg";
  return "application/octet-stream";
}

function contentDisposition(filename: string, download: boolean): string {
  const safeAscii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_") || "attachment";
  return `${download ? "attachment" : "inline"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return undefined;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) return undefined;

  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const message = await prisma.message.findUnique({
    where: { id: params.id },
    select: { mediaUrl: true, mediaName: true, mediaType: true },
  });

  if (!message?.mediaUrl) {
    return NextResponse.json(
      { error: "This attachment was not downloaded during sync." },
      { status: 404 }
    );
  }

  if (/^https?:\/\//i.test(message.mediaUrl)) {
    return NextResponse.redirect(message.mediaUrl, 307);
  }

  const cleanUrl = message.mediaUrl.split(/[?#]/)[0];
  if (!cleanUrl.startsWith("/media/")) {
    return NextResponse.json({ error: "Unsupported media location." }, { status: 400 });
  }

  let relativeName: string;
  try {
    relativeName = decodeURIComponent(cleanUrl.slice("/media/".length));
  } catch {
    return NextResponse.json({ error: "Invalid media location." }, { status: 400 });
  }
  const storedFilename = path.basename(relativeName);
  if (!storedFilename || storedFilename !== relativeName) {
    return NextResponse.json({ error: "Invalid media location." }, { status: 400 });
  }

  const filePath = path.join(MEDIA_DIR, storedFilename);
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    return NextResponse.json({ error: "Attachment file not found." }, { status: 404 });
  }
  if (!stats.isFile() || stats.size === 0) {
    return NextResponse.json({ error: "Attachment file is unavailable." }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = message.mediaName || storedFilename;
  const type = contentType(message.mediaName, storedFilename, message.mediaType);
  const range = parseRange(request.headers.get("range"), stats.size);
  if (range === undefined) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stats.size}` },
    });
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache, must-revalidate",
    "Content-Type": type,
    "Content-Disposition": contentDisposition(filename, download),
    "X-Content-Type-Options": "nosniff",
  });
  if (range) {
    const length = range.end - range.start + 1;
    headers.set("Content-Length", String(length));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
    const stream = fs.createReadStream(filePath, range);
    return new NextResponse(
      Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      { status: 206, headers }
    );
  }

  headers.set("Content-Length", String(stats.size));
  const stream = fs.createReadStream(filePath);
  return new NextResponse(
    Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    { headers }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  await prismaReady;
  const message = await prisma.message.findUnique({
    where: { id: params.id },
    select: {
      externalKey: true,
      mediaUrl: true,
      mediaType: true,
      mediaName: true,
      mediaIsGif: true,
      conversation: {
        select: {
          platform: true,
          accountId: true,
          externalId: true,
        },
      },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }
  const forceRecovery = request.nextUrl.searchParams.get("force") === "1";
  const automatic = request.nextUrl.searchParams.get("automatic") === "1";
  if (automatic && !canAutoLoadMedia(message.conversation.platform, message)) {
    return NextResponse.json({ error: "This attachment needs a manual download." }, { status: 400 });
  }
  if (message.mediaUrl && !forceRecovery) {
    // A URL alone does not prove the file survived a restart or interrupted sync.
    const filename = message.mediaUrl.startsWith("/media/") ? message.mediaUrl.slice(7) : "";
    const cached = filename && path.basename(filename) === filename
      ? await fs.promises.stat(path.join(MEDIA_DIR, filename)).catch(() => null) : null;
    if ((cached?.isFile() && cached.size > 0) || (!automatic && /^https?:\/\//i.test(message.mediaUrl))) {
      return NextResponse.json({ mediaUrl: message.mediaUrl, mediaName: message.mediaName,
        mediaType: message.mediaType, mediaIsGif: message.mediaIsGif });
    }
  }
  if (!message.externalKey || !message.conversation.externalId) {
    return NextResponse.json(
      { error: "This attachment does not have a recoverable platform ID." },
      { status: 409 }
    );
  }

  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  const controller = new AbortController();
  const recoveryTimeout = Number(
    process.env.SYNC_MEDIA_RECOVERY_TIMEOUT_MS || 300_000
  );
  const timer = setTimeout(() => controller.abort(), recoveryTimeout + 5_000);
  try {
    const response = await fetch(`${controlUrl}/media/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: message.conversation.platform,
        accountId: message.conversation.accountId,
        chatExternalId: message.conversation.externalId,
        messageExternalId: message.externalKey,
        automatic,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || "The attachment could not be recovered." },
        { status: response.status === 504 ? 504 : 502 }
      );
    }
    const recovered = await prisma.message.findUnique({
      where: { id: params.id },
      select: { mediaUrl: true, mediaName: true, mediaType: true, mediaIsGif: true },
    });
    if (!recovered?.mediaUrl) {
      return NextResponse.json(
        { error: "The platform did not return a playable attachment." },
        { status: 404 }
      );
    }
    return NextResponse.json(recovered);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.name === "AbortError"
            ? "Attachment recovery timed out. Try again in a moment."
            : "The sync worker is offline.",
      },
      { status: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}
