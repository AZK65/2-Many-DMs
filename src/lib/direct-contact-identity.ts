/** Phone IDs have two connector spellings. LIDs are opaque member IDs,
 * never phone numbers and never interchangeable merely by matching digits. */
export function directRecipientIds(platform: string, target: string, verifiedAliases: string[] = []): string[] {
  const normalize = (value: string) => value.trim().replace(new RegExp(`^${platform}:`), "");
  if (platform !== "whatsapp") return [normalize(target)];
  const ids = new Set<string>();
  for (const value of [target, ...verifiedAliases]) {
    const id = normalize(value).replace(/:\d+(?=@)/, "");
    if (!/^\d+@(lid|c\.us|s\.whatsapp\.net)$/.test(id)) continue;
    ids.add(id.replace(/@s\.whatsapp\.net$/, "@c.us"));
    if (!id.endsWith("@lid")) ids.add(id.replace(/@c\.us$/, "@s.whatsapp.net"));
  }
  return [...ids];
}

export function isGenericDirectIdentity(value?: string | null): boolean {
  return !value?.trim() || /^(whatsapp member|telegram user|group member|member|unknown|you)$/i.test(value.trim()) ||
    /^\+?[\d\s().-]+(?:@(c\.us|s\.whatsapp\.net|lid))?$/.test(value.trim());
}

export function preserveDirectIdentity(saved: { name: string; handle: string } | null, incoming: { name: string; handle: string }) {
  const name = saved && !isGenericDirectIdentity(saved.name) ? saved.name
    : !isGenericDirectIdentity(incoming.name) ? incoming.name : saved?.name || incoming.name;
  const handle = saved?.handle && !/^(whatsapp member|telegram user|group member|member|unknown)$/i.test(saved.handle)
    ? saved.handle : !isGenericDirectIdentity(incoming.handle) || /^\+\d{7,15}$/.test(incoming.handle)
      ? incoming.handle : name;
  return { name, handle };
}
