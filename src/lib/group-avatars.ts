import type { GroupPreviewDTO } from "./types";

export type ObservedGroupMember = {
  conversationId: string;
  id: string;
  name: string;
  avatarUrl: string | null;
  lastSeen: number | bigint;
};

export function avatarSource(src: string | null | undefined) {
  return src?.startsWith("/avatars/") ? `/api${src}` : src;
}

// Exact sender identities only. A matching name does not prove membership.
// Keep the payload bounded, prefer real photos, and keep their positions stable.
export function buildGroupPreviews(rows: ObservedGroupMember[]) {
  const groups = new Map<string, Map<string, ObservedGroupMember>>();
  for (const row of rows) {
    const members = groups.get(row.conversationId) ?? new Map();
    const previous = members.get(row.id);
    if (!previous || Number(row.lastSeen) > Number(previous.lastSeen)) members.set(row.id, row);
    groups.set(row.conversationId, members);
  }
  // Make groups recognizable: a participant unique to this group is more
  // useful visually than the same teammate repeated across hundreds of chats.
  // This is presentation ranking only, not an inference about anyone's role.
  const frequency = new Map<string, number>();
  for (const members of groups.values()) {
    for (const id of members.keys()) frequency.set(id, (frequency.get(id) ?? 0) + 1);
  }
  const previews = new Map<string, GroupPreviewDTO>();
  for (const [conversationId, members] of groups) {
    const ordered = [...members.values()].sort((a, b) =>
      Number(Boolean(b.avatarUrl)) - Number(Boolean(a.avatarUrl)) ||
      frequency.get(a.id)! - frequency.get(b.id)! ||
      Number(b.lastSeen) - Number(a.lastSeen) || a.id.localeCompare(b.id));
    const photos = new Set<string>();
    const selected = ordered.filter(member => {
      // Duplicate cached image URLs should not look like two different people.
      if (!member.avatarUrl) return true;
      const url = avatarSource(member.avatarUrl)!;
      const source = url.startsWith("/api/avatars/") ? url.split("?")[0] : url;
      if (photos.has(source)) return false;
      photos.add(source);
      return true;
    }).slice(0, 4).sort((a, b) => frequency.get(a.id)! - frequency.get(b.id)! || a.id.localeCompare(b.id));
    previews.set(conversationId, {
      count: members.size,
      members: selected.map(({ id, name, avatarUrl }) => ({ id, name, avatarUrl })),
    });
  }
  return previews;
}

export function groupPeopleLabel(preview: GroupPreviewDTO) {
  const names = preview.members.slice(0, 2).map(member => member.name).join(", ");
  const remaining = Math.max(0, preview.count - Math.min(2, preview.members.length));
  return `${names}${remaining ? ` +${remaining}` : ""}`;
}
