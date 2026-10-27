import fs from "node:fs";
import path from "node:path";

export const AVATAR_DIR = path.join(process.cwd(), "public", "avatars");
const AVATAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function fileFor(key: string, ext: string): string {
  return `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.${ext}`;
}

// Returns the served path if we already have this avatar, else null.
export function existingAvatar(key: string, ext = "jpg", allowStale = false): string | null {
  const full = path.join(AVATAR_DIR, fileFor(key, ext));
  if (!fs.existsSync(full)) return null;
  // Profile photos change. Treat the disk copy as a short-lived cache so an
  // active conversation refreshes naturally without downloading every poll.
  try {
    const mtime = fs.statSync(full).mtimeMs;
    if (!allowStale && Date.now() - mtime > AVATAR_MAX_AGE_MS) return null;
    return `/avatars/${fileFor(key, ext)}?v=${Math.floor(mtime)}`;
  } catch {
    return null;
  }
}

export function saveAvatarBuffer(key: string, buf: Buffer, ext = "jpg"): string {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const name = fileFor(key, ext);
  const file = path.join(AVATAR_DIR, name);
  fs.writeFileSync(`${file}.tmp`, buf);
  fs.renameSync(`${file}.tmp`, file);
  return `/avatars/${name}?v=${Math.floor(fs.statSync(file).mtimeMs)}`;
}

export async function saveAvatarFromUrl(
  key: string,
  url: string,
  ext = "jpg"
): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") || 0) > 5_000_000) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 5_000_000) return null;
    // Some platform CDNs send application/octet-stream for real photos.
    // Check bytes rather than rejecting those or saving an HTML error page.
    const header = buf.toString("ascii", 0, 12);
    if (!((buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
      (buf[0] === 0x89 && header.slice(1, 4) === "PNG") ||
      header.startsWith("GIF8") || (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"))) return null;
    return saveAvatarBuffer(key, buf, ext);
  } catch {
    return null;
  }
}
