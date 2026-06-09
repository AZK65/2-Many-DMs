import fs from "node:fs";
import path from "node:path";

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
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const filename = `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.${ext}`;
  const full = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return `/media/${filename}`;
}
