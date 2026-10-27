import { prisma, prismaReady } from "@/lib/db";

export type ChatSearchSource = {
  messageId: string;
  conversationId: string;
  conversationName: string;
  speakerName: string;
  platform: string;
  sentAt: string;
  snippet: string;
};

export type ChatSearchResult = {
  context: string;
  sources: ChatSearchSource[];
};

type SearchMessage = {
  id: string;
  conversationId: string;
  body: string;
  direction: string;
  createdAt: Date;
  senderContact: { name: string } | null;
  conversation: {
    platform: string;
    contact: { name: string; isGroup: boolean };
  };
};

const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "anyone", "anything", "are",
  "around", "be", "been", "being", "but", "can", "chat", "chats", "could",
  "conversation", "conversations", "did", "discuss", "discussed", "do", "does", "exactly",
  "find", "for", "from", "had", "has", "have", "he", "her", "hey", "him",
  "his", "i", "in", "is", "it", "know", "like", "me", "mention", "mentioned",
  "message", "messages", "my", "of", "on", "or", "our", "person", "please",
  "said", "say", "she", "someone", "something", "stuff", "talk", "talked",
  "talking", "tell", "that", "the", "their", "them", "there", "they", "this",
  "to", "us", "was", "we", "were", "what", "when", "where", "which", "who",
  "with", "you", "your",
]);

const TERM_ALIASES: Record<string, string[]> = {
  ad: ["ad account", "ads", "advertising", "media buying"],
  ads: ["ad account", "ads", "advertising", "media buying"],
  advertising: ["ad account", "ads", "advertising", "media buying"],
  facebook: ["facebook", "meta"],
  fb: ["facebook", "meta"],
  meta: ["meta", "facebook"],
  whatsapp: ["whatsapp", "wa"],
  telegram: ["telegram", "tg"],
  twitter: ["twitter", "x.com"],
};

const MAX_CONTEXT_CHARS = 14_000;

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@.$%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(value: string, term: string): boolean {
  const haystack = normalized(value);
  const needle = normalized(term);
  return !!needle && ` ${haystack} `.includes(` ${needle} `);
}

function queryGroups(question: string): string[][] {
  const tokens = normalized(question)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .slice(-10);
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const root = token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
    const values = TERM_ALIASES[token] || TERM_ALIASES[root] || [token, root];
    const usable = [...new Set(values.map(normalized).filter((value) => value.length >= 3))];
    const key = usable.join("|");
    if (!usable.length || seen.has(key)) continue;
    seen.add(key);
    groups.push(usable);
  }
  return groups.slice(0, 7);
}

function messageWhere(groups: string[][], requireEveryGroup: boolean) {
  const clauses = groups.map((group) => ({
    OR: group.flatMap((term) => [
      { body: { contains: term } },
      { originalBody: { contains: term } },
      { translatedBody: { contains: term } },
      { senderContact: { name: { contains: term } } },
      { conversation: { contact: { name: { contains: term } } } },
    ]),
  }));
  return requireEveryGroup ? { AND: clauses } : { OR: clauses };
}

function speakerFor(message: SearchMessage): string {
  if (message.direction === "out") return "You";
  return message.senderContact?.name || message.conversation.contact.name;
}

function scoreMessage(message: SearchMessage, groups: string[][], question: string): number {
  const body = normalized(message.body);
  const names = normalized(
    `${speakerFor(message)} ${message.conversation.contact.name} ${message.conversation.platform}`,
  );
  let score = 0;
  for (const group of groups) {
    const bodyMatch = group.some((term) => containsTerm(body, term));
    const nameMatch = group.some((term) => containsTerm(names, term));
    if (bodyMatch) score += 20;
    else if (nameMatch) score += 10;
  }
  const phrase = normalized(question);
  if (phrase.length > 5 && body.includes(phrase)) score += 60;
  for (let index = 0; index < groups.length - 1; index++) {
    const left = groups[index].some((term) => containsTerm(body, term));
    const right = groups[index + 1].some((term) => containsTerm(body, term));
    if (left && right) score += 8;
  }
  const asksAboutOwnMessages = /\b(did i|have i|i (?:say|said|send|sent|tell|told)|my message)\b/i.test(question);
  if (asksAboutOwnMessages) score += message.direction === "out" ? 20 : -5;
  else if (message.direction === "in") score += 4;
  if (!message.conversation.contact.isGroup) score += 6;
  if (/\bbot\b/i.test(`${speakerFor(message)} ${message.conversation.contact.name}`)) score -= 30;
  return score;
}

function matchedGroupCount(message: SearchMessage, groups: string[][]): number {
  const searchable = [
    message.body,
    speakerFor(message),
    message.conversation.contact.name,
    message.conversation.platform,
  ].join(" ");
  return groups.filter((group) => group.some((term) => containsTerm(searchable, term))).length;
}

function trimMessage(value: string, max = 900): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}…`;
}

async function nearbyMessages(hit: SearchMessage, take = 4): Promise<SearchMessage[]> {
  const windowStart = new Date(hit.createdAt.getTime() - 6 * 60 * 60 * 1000);
  const windowEnd = new Date(hit.createdAt.getTime() + 6 * 60 * 60 * 1000);
  const select = {
    id: true,
    conversationId: true,
    body: true,
    direction: true,
    createdAt: true,
    senderContact: { select: { name: true } },
    conversation: {
      select: {
        platform: true,
        contact: { select: { name: true, isGroup: true } },
      },
    },
  } as const;
  const [before, after] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: hit.conversationId,
        createdAt: { gte: windowStart, lte: hit.createdAt },
      },
      orderBy: { createdAt: "desc" },
      take,
      select,
    }),
    prisma.message.findMany({
      where: {
        conversationId: hit.conversationId,
        createdAt: { gt: hit.createdAt, lte: windowEnd },
      },
      orderBy: { createdAt: "asc" },
      take,
      select,
    }),
  ]);
  return [...before.reverse(), ...after];
}

function focusedIdentifierWindow(
  hit: SearchMessage,
  messages: SearchMessage[],
): SearchMessage[] {
  const keep = new Set<string>([hit.id]);
  messages.forEach((message, index) => {
    if (!/\b\d{6,8}\b/.test(message.body)) return;
    for (let nearbyIndex = Math.max(0, index - 1); nearbyIndex <= Math.min(messages.length - 1, index + 1); nearbyIndex++) {
      keep.add(messages[nearbyIndex].id);
    }
  });
  if (keep.size === 1) {
    const hitIndex = messages.findIndex((message) => message.id === hit.id);
    for (let index = Math.max(0, hitIndex - 3); index <= Math.min(messages.length - 1, hitIndex + 3); index++) {
      keep.add(messages[index].id);
    }
  }
  return messages.filter((message) => keep.has(message.id)).slice(0, 10);
}

export async function searchAllChats(question: string): Promise<ChatSearchResult> {
  await prismaReady;
  const query = question.trim().slice(0, 2_000);
  const groups = queryGroups(query);
  if (!query || !groups.length) return { context: "", sources: [] };

  const select = {
    id: true,
    conversationId: true,
    body: true,
    direction: true,
    createdAt: true,
    senderContact: { select: { name: true } },
    conversation: {
      select: {
        platform: true,
        contact: { select: { name: true, isGroup: true } },
      },
    },
  } as const;
  const [strictMatches, broadMatches] = await Promise.all([
    prisma.message.findMany({
      where: messageWhere(groups, true),
      orderBy: { createdAt: "desc" },
      take: 240,
      select,
    }),
    prisma.message.findMany({
      where: messageWhere(groups, false),
      orderBy: { createdAt: "desc" },
      take: 600,
      select,
    }),
  ]);

  const unique = new Map<string, SearchMessage>();
  for (const message of [...strictMatches, ...broadMatches]) unique.set(message.id, message);
  const ranked = [...unique.values()]
    .map((message) => ({
      message,
      matchedGroups: matchedGroupCount(message, groups),
      score: scoreMessage(message, groups, query),
    }))
    .filter((item) => item.matchedGroups > 0 && item.score > 0)
    .sort(
      (left, right) =>
        right.matchedGroups - left.matchedGroups ||
        right.score - left.score ||
        right.message.createdAt.getTime() - left.message.createdAt.getTime(),
    );

  const candidates: Array<(typeof ranked)[number]> = [];
  const perConversation = new Map<string, number>();
  const resultLimit = /\b(all|every|everyone|anyone|list them)\b/i.test(query) ? 8 : 5;
  const identifierLookup = /\b(bins?|routing numbers?|account numbers?)\b/i.test(query);
  const candidateLimit = identifierLookup ? 60 : Math.max(resultLimit * 3, 15);
  for (const item of ranked) {
    const { message } = item;
    if (candidates.length >= candidateLimit) break;
    if ((perConversation.get(message.conversationId) || 0) >= 1) continue;
    candidates.push(item);
    perConversation.set(message.conversationId, 1);
  }
  if (!candidates.length) return { context: "", sources: [] };

  const candidateWindows = await Promise.all(
    candidates.map(({ message }) => nearbyMessages(message, identifierLookup ? 16 : 4)),
  );
  const ordered = candidates
    .map((item, index) => {
      const nearbyText = candidateWindows[index].map((message) => message.body).join(" ");
      const hasRequestedIdentifier = identifierLookup && /\b\d{6,8}\b/.test(nearbyText);
      return {
        ...item,
        nearby: identifierLookup
          ? focusedIdentifierWindow(item.message, candidateWindows[index])
          : candidateWindows[index],
        evidenceScore: hasRequestedIdentifier && item.matchedGroups === groups.length ? 100 : 0,
      };
    })
    .sort(
      (left, right) =>
        right.evidenceScore - left.evidenceScore ||
        right.matchedGroups - left.matchedGroups ||
        right.score - left.score ||
        right.message.createdAt.getTime() - left.message.createdAt.getTime(),
    )
    .slice(0, resultLimit);

  const selected = ordered.map(({ message }) => message);
  const windows = ordered.map(({ nearby }) => nearby);
  let contextLength = 0;
  const contextParts: string[] = [];
  const included: SearchMessage[] = [];
  for (let index = 0; index < selected.length; index++) {
    const hit = selected[index];
    const excerpt = windows[index]
      .map(
        (message) =>
          `- ${message.createdAt.toISOString()} · ${message.direction === "out" ? "outbound" : "inbound"} · ${speakerFor(message)}: ${trimMessage(message.body)}`,
      )
      .join("\n");
    const block = [
      `[CHAT RESULT ${index + 1}]`,
      `Message ID: ${hit.id}`,
      `Conversation ID: ${hit.conversationId}`,
      `Conversation: ${hit.conversation.contact.name}`,
      `Platform: ${hit.conversation.platform}`,
      `Matched speaker: ${speakerFor(hit)}`,
      `Matched at: ${hit.createdAt.toISOString()}`,
      "Nearby messages:",
      excerpt,
    ].join("\n");
    const remaining = MAX_CONTEXT_CHARS - contextLength;
    if (remaining < 500) break;
    contextParts.push(block.slice(0, remaining));
    contextLength += Math.min(block.length, remaining);
    included.push(hit);
  }

  return {
    context: contextParts.join("\n\n---\n\n"),
    sources: included.map((message) => ({
      messageId: message.id,
      conversationId: message.conversationId,
      conversationName: message.conversation.contact.name,
      speakerName: speakerFor(message),
      platform: message.conversation.platform,
      sentAt: message.createdAt.toISOString(),
      snippet: trimMessage(message.body, 180),
    })),
  };
}

export async function loadChatResultsByMessageIds(
  messageIds: string[],
): Promise<ChatSearchResult> {
  await prismaReady;
  const orderedIds = [...new Set(messageIds.filter(Boolean))].slice(0, 12);
  if (!orderedIds.length) return { context: "", sources: [] };
  const messages = await prisma.message.findMany({
    where: { id: { in: orderedIds } },
    select: {
      id: true,
      conversationId: true,
      body: true,
      direction: true,
      createdAt: true,
      senderContact: { select: { name: true } },
      conversation: {
        select: {
          platform: true,
          contact: { select: { name: true, isGroup: true } },
        },
      },
    },
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((message): message is SearchMessage => !!message);
  const windows = await Promise.all(ordered.map((message) => nearbyMessages(message, 6)));
  let contextLength = 0;
  const contextParts: string[] = [];
  const included: SearchMessage[] = [];
  for (let index = 0; index < ordered.length; index++) {
    const hit = ordered[index];
    const excerpt = windows[index]
      .map(
        (message) =>
          `- ${message.createdAt.toISOString()} · ${message.direction === "out" ? "outbound" : "inbound"} · ${speakerFor(message)}: ${trimMessage(message.body)}`,
      )
      .join("\n");
    const block = [
      `[PREVIOUS CHAT RESULT ${index + 1}]`,
      `Message ID: ${hit.id}`,
      `Conversation ID: ${hit.conversationId}`,
      `Conversation: ${hit.conversation.contact.name}`,
      `Platform: ${hit.conversation.platform}`,
      `Matched speaker: ${speakerFor(hit)}`,
      `Matched at: ${hit.createdAt.toISOString()}`,
      "Nearby messages:",
      excerpt,
    ].join("\n");
    const remaining = MAX_CONTEXT_CHARS - contextLength;
    if (remaining < 500) break;
    contextParts.push(block.slice(0, remaining));
    contextLength += Math.min(block.length, remaining);
    included.push(hit);
  }
  return {
    context: contextParts.join("\n\n---\n\n"),
    sources: included.map((message) => ({
      messageId: message.id,
      conversationId: message.conversationId,
      conversationName: message.conversation.contact.name,
      speakerName: speakerFor(message),
      platform: message.conversation.platform,
      sentAt: message.createdAt.toISOString(),
      snippet: trimMessage(message.body, 180),
    })),
  };
}
