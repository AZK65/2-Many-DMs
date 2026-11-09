// Shared by ingestion and the browser. Keep this module free of server imports.
export function isNativeXMessageKey(key: string | null | undefined): boolean {
  return /^x:(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i.test(key || "");
}

// X hides the scheme on rendered links. Compare the complete remaining URL
// and text, not a fuzzy substring, so distinct links/messages stay distinct.
export function normalizeXMessageText(text: string): string {
  return text.replace(/\bhttps?:\/\/(?=[a-z0-9.-]+\.[a-z]{2,}\b)/gi, "").replace(/\s+/g, " ").trim();
}

// X also clips request previews at 200 characters WITHOUT an ellipsis. Match
// that exact rendering boundary (including trimmed whitespace and emoji), not
// arbitrary prefixes. Older captures count UTF-16 units; X counts code points.
// Callers must also verify direction, time and a unique candidate. A bare
// prefix ("yes" vs "yes please") is never enough to combine messages.
export function xPreviewMatchesText(preview: string, full: string): boolean {
  const short = normalizeXMessageText(preview);
  const complete = normalizeXMessageText(full);
  if (short === complete) return true;
  // X's inbox reduces a shared post to this generic label. The native DM row
  // exposes the post URL only after the conversation hydrates, so allow that
  // exact label to promote into the richer, link-backed message.
  if (/^(?:sent|shared) (?:a )?post$/i.test(short) &&
      /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[^/\s]+\/status\/\d+/i.test(complete)) return true;
  const prefix = short.replace(/(?:…|\.{3})$/, "").trimEnd();
  if (prefix !== short && prefix.length >= 24 && complete.length > prefix.length && complete.startsWith(prefix)) return true;
  if (short.length < 24 || complete.length <= short.length) return false;
  return [full.trim(), complete].some(text =>
    [text.slice(0, 200), Array.from(text).slice(0, 200).join("")].some(capped => normalizeXMessageText(capped) === short));
}

// Repeated reads of the SAME native ID can race decryption/hydration. Promote
// a longer compatible body, but never replace full text with a short viewport.
export function richerXMessageText(previous: string, incoming: string): string {
  if (!previous) return incoming;
  // Repair the known wrapper regression ONLY when a fresh read of this SAME
  // native ID proves that its suffix was the duplicated timestamp UI.
  if (previous.startsWith(incoming) && /^(?:\r?\n)(\d{1,2}:\d{2}\s*[AP]M)\r?\n\1\s*$/i.test(previous.slice(incoming.length))) return incoming;
  const before = normalizeXMessageText(previous);
  const after = normalizeXMessageText(incoming);
  return after.length > before.length && (after.startsWith(before) || xPreviewMatchesText(previous, incoming)) ? incoming : previous;
}
