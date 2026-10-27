export type WhatsAppIdentity = { externalKey: string; name: string; handle?: string };

export function isPlaceholderIdentity(value?: string | null): boolean {
  const name = (value || "").trim();
  return !name || /^(group chat|group|member|whatsapp member|unknown)$/i.test(name) ||
    /^\+?[\d\s().-]{7,}(?:@(c\.us|lid|g\.us))?$/.test(name);
}

export function whatsappDisplayName(contact: any): string | undefined {
  return [contact?.name, contact?.pushname, contact?.shortName, contact?.verifiedName]
    .find((value) => typeof value === "string" && !isPlaceholderIdentity(value))?.trim();
}
