import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MEDIA_DIR = path.join(process.cwd(), "public", "media");
export const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 25) * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};

export function extFromMime(mime: string, fallback = "bin"): string {
  const clean = (mime || "").split(";")[0].trim();
  if (MIME_EXT[clean]) return MIME_EXT[clean];
  const sub = clean.split("/")[1];
  return sub || fallback;
}

// Writes a media buffer under public/media and returns the served path.
// Idempotent: a file that already exists (same key) is not rewritten.
export function saveMedia(key: string, ext: string, buf: Buffer): string {
  const { full, url } = mediaLocation(key, ext);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return url;
}

function mediaLocation(key: string, ext: string): { full: string; url: string } {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const safeExtension = ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const filename = `${safeKey}.${safeExtension}`;
  return {
    full: path.join(MEDIA_DIR, filename),
    url: `/media/${filename}`,
  };
}

// Manual recovery can legitimately pull files much larger than the normal
// message-sync limit. Stream them to disk so a large WhatsApp document does
// not have to exist as a second, base64-expanded copy in worker memory.
export async function saveMediaStream(
  key: string,
  ext: string,
  source: Readable,
  maxBytes: number
): Promise<string> {
  const { full, url } = mediaLocation(key, ext);
  if (fs.existsSync(full)) {
    source.destroy();
    return url;
  }

  const temporary = `${full}.${randomUUID()}.part`;
  let size = 0;
  const limiter = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback
    ) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        callback(
          new Error(
            `This attachment is larger than the ${Math.round(
              maxBytes / 1024 / 1024
            )} MB attachment limit.`
          )
        );
        return;
      }
      callback(null, buffer);
    },
  });

  try {
    await pipeline(source, limiter, fs.createWriteStream(temporary, { flags: "wx" }));
    if (!size) throw new Error("The platform returned an empty attachment.");
    await fs.promises.rename(temporary, full);
    return url;
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
