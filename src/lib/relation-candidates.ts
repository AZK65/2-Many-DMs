import type { Platform } from "./platforms";

export type RelationChat = {
  id: string; contactId: string; platform: Platform; externalId: string | null;
  name: string; handle: string; avatarUrl: string | null; isGroup: boolean;
  email: string | null; phone: string | null; company: string | null;
  accountLabel: string | null; archived: boolean; hidden: boolean; lastMessageAt: string;
};
export type RelationMember = {
  conversationId: string; id: string; name: string; handle: string;
  email: string | null; phone: string | null; avatarUrl: string | null;
};
export type RelationCandidate = RelationChat & {
  sharedMembers: { id: string; name: string; avatarUrl: string | null }[];
  sharedCount: number;
  reason: "same-contact" | "member-direct" | "shared-members" | null;
  matchedMemberNames: string[];
};
export type RelationCandidatePage = { items: RelationCandidate[]; total: number; nextOffset: number | null };

const normalized = (value: string) => value.normalize("NFKC").trim().toLowerCase();

/** Exact saved contact IDs only: names, shared business inboxes and opaque WA
 * LIDs must never silently turn two different people into one identity. */
export function findRelationCandidates({ source, chats, members, linkedIds = [], query = "", scope = "suggested", offset = 0, limit = 20 }: {
  source: RelationChat; chats: RelationChat[]; members: RelationMember[];
  linkedIds?: string[]; query?: string; scope?: "suggested" | "all"; offset?: number; limit?: number;
}): RelationCandidatePage {
  const byChat = new Map<string, Map<string, RelationMember>>();
  const frequency = new Map<string, Set<string>>();
  for (const member of members) {
    if (!byChat.has(member.conversationId)) byChat.set(member.conversationId, new Map());
    byChat.get(member.conversationId)!.set(member.id, member);
    if (!frequency.has(member.id)) frequency.set(member.id, new Set());
    frequency.get(member.id)!.add(member.conversationId);
  }
  const sourceMembers = source.isGroup ? byChat.get(source.id) || new Map<string, RelationMember>() : new Map([[source.contactId, {
    conversationId: source.id, id: source.contactId, name: source.name, handle: source.handle,
    email: source.email, phone: source.phone, avatarUrl: source.avatarUrl,
  }]]);
  const linked = new Set(linkedIds);
  const q = normalized(query);
  const matches = (values: (string | null)[]) => values.some(value => value && normalized(value).includes(q));
  const result: (RelationCandidate & { score: number })[] = [];
  for (const chat of chats) {
    if (chat.id === source.id || linked.has(chat.id)) continue;
    // An alternate account's view of the same group isn't another client chat.
    if (source.isGroup && chat.isGroup && (chat.contactId === source.contactId ||
      (chat.platform === source.platform && chat.externalId && chat.externalId === source.externalId))) continue;
    const candidates = chat.isGroup ? byChat.get(chat.id) || new Map<string, RelationMember>() : new Map([[chat.contactId, {
      conversationId: chat.id, id: chat.contactId, name: chat.name, handle: chat.handle,
      email: chat.email, phone: chat.phone, avatarUrl: chat.avatarUrl,
    }]]);
    const shared = [...candidates.values()].filter(member => sourceMembers.has(member.id));
    const sameContact = !source.isGroup && !chat.isGroup && chat.contactId === source.contactId;
    const reason = sameContact ? "same-contact" : shared.length ? (chat.isGroup ? "shared-members" : "member-direct") : null;
    if (scope === "suggested" && !reason) continue;
    const matchedMembers = q ? [...candidates.values()].filter(member => matches([member.name, member.handle, member.email, member.phone])) : [];
    if (q && !matches([chat.name, chat.handle, chat.email, chat.phone, chat.company, chat.platform]) && !matchedMembers.length) continue;
    // Prefer distinctive shared clients over a teammate who appears everywhere.
    const rarity = shared.reduce((score, member) => score + 1 / Math.max(1, frequency.get(member.id)?.size || 0), 0);
    shared.sort((a, b) => (frequency.get(a.id)?.size || 0) - (frequency.get(b.id)?.size || 0) || a.name.localeCompare(b.name));
    result.push({ ...chat, reason, sharedCount: shared.length,
      sharedMembers: shared.slice(0, 4).map(({ id, name, avatarUrl }) => ({ id, name, avatarUrl })),
      matchedMemberNames: matchedMembers.slice(0, 3).map(member => member.name),
      score: (sameContact ? 1000 : 0) + shared.length * 10 + rarity,
    });
  }
  result.sort((a, b) => b.score - a.score || b.lastMessageAt.localeCompare(a.lastMessageAt) || a.id.localeCompare(b.id));
  const start = Math.max(0, offset), size = Math.max(1, Math.min(30, limit));
  return { items: result.slice(start, start + size).map(({ score: _score, ...item }) => item), total: result.length, nextOffset: start + size < result.length ? start + size : null };
}
