export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function emailsIn(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) || []).map((email) => email.toLowerCase()))];
}
