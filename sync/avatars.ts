import fs from "node:fs";
import path from "node:path";

export const AVATAR_DIR = path.join(process.cwd(), "public", "avatars");

function fileFor(key: string, ext: string): string {
  return `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.${ext}`;
}

// Returns the served path if we already have this avatar, else null.
export function existingAvatar(key: string, ext = "jpg"): string | null {
  const full = path.join(AVATAR_DIR, fileFor(key, ext));
  return fs.existsSync(full) ? `/avatars/${fileFor(key, ext)}` : null;
}

export function saveAvatarBuffer(key: string, buf: Buffer, ext = "jpg"): string {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const name = fileFor(key, ext);
  fs.writeFileSync(path.join(AVATAR_DIR, name), buf);
  return `/avatars/${name}`;
}

export async function saveAvatarFromUrl(
  key: string,
  url: string,
  ext = "jpg"
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return saveAvatarBuffer(key, buf, ext);
  } catch {
    return null;
  }
}
