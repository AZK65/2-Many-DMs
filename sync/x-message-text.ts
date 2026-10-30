// X hides the scheme on rendered links. Compare the complete remaining URL
// and text, not a fuzzy substring, so distinct links/messages stay distinct.
export function normalizeXMessageText(text: string): string {
  return text.replace(/\bhttps?:\/\/(?=[a-z0-9.-]+\.[a-z]{2,}\b)/gi, "").replace(/\s+/g, " ").trim();
}

// Only an explicitly truncated, substantial preview may match a full body.
// Callers must also verify direction, time and a unique candidate. A bare
// prefix ("yes" vs "yes please") is never enough to combine messages.
export function xPreviewMatchesText(preview: string, full: string): boolean {
  const short = normalizeXMessageText(preview);
  const complete = normalizeXMessageText(full);
  if (short === complete) return true;
  const prefix = short.replace(/(?:…|\.{3})$/, "").trimEnd();
  return prefix !== short && prefix.length >= 24 && complete.length > prefix.length && complete.startsWith(prefix);
}

// Repeated reads of the SAME native ID can race decryption/hydration. Promote
// a longer compatible body, but never replace full text with a short viewport.
export function richerXMessageText(previous: string, incoming: string): string {
  if (!previous) return incoming;
  const before = normalizeXMessageText(previous);
  const after = normalizeXMessageText(incoming);
  return after.length > before.length && (after.startsWith(before) || xPreviewMatchesText(previous, incoming)) ? incoming : previous;
}
