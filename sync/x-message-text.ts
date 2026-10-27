// X hides the scheme on rendered links. Compare the complete remaining URL
// and text, not a fuzzy substring, so distinct links/messages stay distinct.
export function normalizeXMessageText(text: string): string {
  return text.replace(/\bhttps?:\/\/(?=[a-z0-9.-]+\.[a-z]{2,}\b)/gi, "").replace(/\s+/g, " ").trim();
}
