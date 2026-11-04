const MESSAGE_URL_RE = /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}\/)[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION_RE = /[),.!?;:\]}]+$/;

export type MessageLink = {
  start: number;
  matched: string;
  url: string;
  trailingPunctuation: string;
};

export function messageLinks(text: string): MessageLink[] {
  const links: MessageLink[] = [];
  for (const match of text.matchAll(MESSAGE_URL_RE)) {
    const start = match.index ?? 0;
    // Do not interpret the domain half of an email address as a web link.
    if (start > 0 && /[@\w]/.test(text[start - 1])) continue;
    let raw = match[0];
    const trailingPunctuation = raw.match(TRAILING_URL_PUNCTUATION_RE)?.[0] || "";
    if (trailingPunctuation) raw = raw.slice(0, -trailingPunctuation.length);
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    links.push({ start, matched: match[0], url, trailingPunctuation });
  }
  return links;
}
