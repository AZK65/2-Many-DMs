// A read-only projection: identity matching never changes CRM contacts.
export type NetworkContact = {
  id: string; name: string; handle: string; email: string | null;
  phone: string | null; externalKey: string | null;
};
export type NetworkChat = {
  id: string; contactId: string; name: string; platform: string;
  externalId: string | null; isGroup: boolean;
};
export type NetworkMembership = { contactId: string; conversationId: string; lastSeen: string };
export type NetworkPerson = {
  id: string; name: string; records: NetworkContact[]; platforms: string[];
  groupIds: string[]; directChats: { id: string; platform: string }[];
  matchReasons: string[];
};
export type NetworkGroup = {
  id: string; name: string; platform: string; conversationId: string;
  members: { personId: string; lastSeen: string }[];
};
export type PeopleNetwork = {
  people: NetworkPerson[]; groups: NetworkGroup[];
  generatedAt: string; sourceContacts: number;
};

export function normalizedName(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function usableName(name: string) {
  return name.length >= 3 && /\p{L}/u.test(name) &&
    !/^(unknown|user|member|whatsapp member|contact|deleted account|you|me|group chat)$/.test(name);
}

function realPhone(c: NetworkContact) {
  // WhatsApp LIDs look like phone numbers but are NOT phone numbers.
  const pn = c.externalKey?.match(/^whatsapp:(\d+)@(?:s\.whatsapp\.net|c\.us)$/)?.[1];
  const raw = pn ? `+${pn}` : c.externalKey?.includes("@lid") ? "" : c.phone || "";
  const phone = raw.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function buildPeopleNetwork(
  contacts: NetworkContact[], chats: NetworkChat[], memberships: NetworkMembership[],
): PeopleNetwork {
  const sorted = [...contacts].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(sorted.map(c => [c.id, c]));
  const parent = new Map(sorted.map(c => [c.id, c.id]));
  const reasons = new Map<string, Set<string>>();
  function root(id: string): string {
    const p = parent.get(id)!;
    if (p === id) return id;
    const r = root(p); parent.set(id, r); return r;
  }
  const keys = new Map<string, string>();
  for (const c of sorted) {
    const name = normalizedName(c.name);
    const phone = realPhone(c);
    const email = c.email?.trim().toLowerCase();
    const identifiers: [string, string][] = [];
    if (c.externalKey) identifiers.push([`source:${c.externalKey}`, "Same platform identity"]);
    // Require the name to corroborate phone/email. Shared company mailboxes and
    // recycled phone numbers must not join differently named people.
    if (usableName(name) && phone) identifiers.push([`phone:${phone}:${name}`, "Matching name and phone"]);
    if (usableName(name) && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      identifiers.push([`email:${email}:${name}`, "Matching name and email"]);
    }
    for (const [key, reason] of identifiers) {
      const other = keys.get(key);
      if (!other) { keys.set(key, c.id); continue; }
      const a = root(other), b = root(c.id);
      if (a === b) continue;
      const winner = a < b ? a : b, loser = a < b ? b : a;
      parent.set(loser, winner);
      reasons.set(winner, new Set([...(reasons.get(a) || []), ...(reasons.get(b) || []), reason]));
    }
  }
  const people = new Map<string, NetworkPerson>();
  for (const c of sorted) {
    const id = root(c.id);
    if (!people.has(id)) people.set(id, { id, name: c.name, records: [], platforms: [], groupIds: [], directChats: [], matchReasons: [...(reasons.get(id) || [])] });
    const person = people.get(id)!;
    person.records.push(c);
    const platform = c.externalKey?.split(":")[0];
    if (platform && !person.platforms.includes(platform)) person.platforms.push(platform);
  }
  const groups = new Map<string, NetworkGroup>();
  const chatGroup = new Map<string, string>();
  for (const chat of chats) {
    if (chat.isGroup) {
      const key = chat.externalId ? `${chat.platform}:${chat.externalId}` : chat.id;
      if (!groups.has(key)) groups.set(key, { id: key, name: chat.name, platform: chat.platform, conversationId: chat.id, members: [] });
      chatGroup.set(chat.id, key);
    } else if (byId.has(chat.contactId)) {
      const person = people.get(root(chat.contactId))!;
      person.directChats.push({ id: chat.id, platform: chat.platform });
      if (!person.platforms.includes(chat.platform)) person.platforms.push(chat.platform);
    }
  }
  const seen = new Map<string, Map<string, string>>();
  for (const m of memberships) {
    const groupId = chatGroup.get(m.conversationId);
    if (!groupId || !byId.has(m.contactId)) continue;
    const personId = root(m.contactId);
    const members = seen.get(groupId) || new Map<string, string>();
    members.set(personId, [members.get(personId) || "", m.lastSeen].sort().pop()!);
    seen.set(groupId, members);
  }
  for (const [groupId, members] of seen) {
    const group = groups.get(groupId)!;
    group.members = [...members].map(([personId, lastSeen]) => ({ personId, lastSeen }));
    for (const member of group.members) {
      const person = people.get(member.personId)!;
      person.groupIds.push(groupId);
      if (!person.platforms.includes(group.platform)) person.platforms.push(group.platform);
    }
  }
  return {
    people: [...people.values()].filter(p => p.groupIds.length || p.directChats.length)
      .sort((a, b) => b.groupIds.length - a.groupIds.length || a.name.localeCompare(b.name)),
    groups: [...groups.values()].filter(g => g.members.length),
    generatedAt: new Date().toISOString(), sourceContacts: contacts.length,
  };
}

export function possibleIdentityMatches(person: NetworkPerson, people: NetworkPerson[]) {
  const names = new Set(person.records.map(c => normalizedName(c.name)).filter(usableName));
  return people.filter(p => p.id !== person.id && p.records.some(c => names.has(normalizedName(c.name))))
    .map(p => {
      const shared = p.groupIds.filter(id => person.groupIds.includes(id)).length;
      const handles = new Set(person.records.map(c => c.handle.toLowerCase()).filter(h => /^@\w{3,}$/.test(h)));
      const sameHandle = p.records.some(c => handles.has(c.handle.toLowerCase()));
      return { person: p, shared, sameHandle };
    }).sort((a, b) => Number(b.sameHandle) - Number(a.sameHandle) || b.shared - a.shared);
}

// Bipartite BFS avoids creating quadratic person-to-person edges in large groups.
// A path is evidence of shared chats, not a claim of a personal relationship.
export function findNetworkPath(data: PeopleNetwork, from: string, to: string, maxHops = 3) {
  const people = new Map(data.people.map(p => [p.id, p]));
  const groups = new Map(data.groups.map(g => [g.id, g]));
  if (!people.has(from) || !people.has(to)) return null;
  const queue: { personId: string; steps: { personId: string; groupId: string }[] }[] = [{ personId: from, steps: [] }];
  const visited = new Set([from]); const visitedGroups = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.personId === to) return item.steps;
    if (item.steps.length >= maxHops) continue;
    for (const gid of people.get(item.personId)?.groupIds || []) {
      if (visitedGroups.has(gid)) continue;
      visitedGroups.add(gid);
      for (const { personId } of groups.get(gid)?.members || []) {
        if (visited.has(personId)) continue;
        visited.add(personId);
        queue.push({ personId, steps: [...item.steps, { personId, groupId: gid }] });
      }
    }
  }
  return null;
}
