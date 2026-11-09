export function normalizedXPostUrl(rawUrl: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const host = url.hostname.replace(/^www\./, "");
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match || !["x.com", "twitter.com"].includes(host)) return null;
    return `https://x.com/${encodeURIComponent(match[1])}/status/${match[2]}`;
  } catch {
    return null;
  }
}

const X_POST_URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[^\s<>"']+\/status\/\d+(?:\?[^\s<>"']*)?/gi;

export function xPostUrlFromText(text: string): string | null {
  for (const match of text.matchAll(X_POST_URL_RE)) {
    const normalized = normalizedXPostUrl(match[0]);
    if (normalized) return normalized;
  }
  return null;
}

export function isSharedXPostMessage(text: string): boolean {
  const url = xPostUrlFromText(text);
  if (!url) return false;
  const label = text
    .replace(X_POST_URL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return label === "" || /^(?:sent|shared) (?:a )?post$/i.test(label);
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] === "#") {
      const code = key[1].toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return entities[key.toLowerCase()] ?? entity;
  });
}

export function xPostTextFromOembed(html: string): string | null {
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (!paragraph) return null;
  const text = decodeEntities(paragraph.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\r/g, "").trim();
  return text || null;
}
