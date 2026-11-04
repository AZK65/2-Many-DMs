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
