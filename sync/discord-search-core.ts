import type { InboundMessage } from "./adapters/types";

export type DiscordPerson = { id: string; username?: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
export type DiscordPrivateChat = { id: string; type: number; name?: string; recipients?: DiscordPerson[]; last_message_id?: string | null; icon?: string | null; is_message_request?: boolean; is_spam?: boolean };

export function discordInboxCategory(chat: DiscordPrivateChat): "general" | "spam" | undefined {
  if (chat.is_message_request === true || chat.is_spam === true) return "spam";
  // REST omits these flags. Missing fields must not promote an unaccepted DM.
  return chat.is_message_request === false && chat.is_spam === false ? "general" : undefined;
}

export function mergeDiscordPrivateChat(previous: DiscordPrivateChat | undefined, incoming: DiscordPrivateChat): DiscordPrivateChat {
  return { ...previous, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined)) } as DiscordPrivateChat;
}
export type DiscordSearchMessage = {
  id: string; channel_id: string; content?: string; timestamp: string; author: DiscordPerson;
  attachments?: { filename: string; content_type?: string; url?: string }[];
  message_reference?: { message_id?: string };
  referenced_message?: { content?: string; author?: DiscordPerson } | null;
};

export const DISCORD_SEARCH_DRIVER = "personal-readonly";
export function discordReadPath(path: string) {
  return /^\/(?:users\/@me(?:\/channels)?|gateway)$/.test(path) ||
    /^\/channels\/\d+\/messages(?:\/\d+|\?(?:limit=\d+)(?:&before=\d+)?)?$/.test(path);
}
export function discordPhoto(user?: DiscordPerson) {
  return user?.avatar && /^\d+$/.test(user.id) && /^[a-zA-Z0-9_]+$/.test(user.avatar)
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
    : undefined;
}
export function discordPersonName(user?: DiscordPerson) {
  return user?.global_name || user?.username || "Discord member";
}
export function privateDiscordMessage(chat: DiscordPrivateChat, message: DiscordSearchMessage, selfId: string): InboundMessage | null {
  if (![1, 3].includes(chat.type) || !/^\d+$/.test(chat.id) || message.channel_id !== chat.id ||
      !/^\d+$/.test(message.id) || !/^\d+$/.test(message.author?.id || "")) return null;
  const timestamp = new Date(message.timestamp);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const people = (chat.recipients || []).filter(person => person.id !== selfId);
  const peer = people[0] || (message.author.id !== selfId ? message.author : undefined);
  const group = chat.type === 3;
  const name = group ? chat.name || people.map(discordPersonName).join(", ") || "Discord group" : discordPersonName(peer);
  const attachments = (message.attachments || []).map(file => file.filename).filter(Boolean);
  const body = [message.content || "", attachments.length ? `Attachments: ${attachments.join(", ")}` : ""].filter(Boolean).join("\n");
  // Read-only indexing must never create unread floods or trigger outbound rules,
  // including when the indexed message arrived over the live gateway.
  return {
    platform: "discord", chatExternalId: chat.id, messageExternalId: `discord:${chat.id}:${message.id}`,
    direction: message.author.id === selfId ? "out" : "in", body, timestamp, timestampVerified: true, historical: true,
    isGroup: group, inboxCategory: discordInboxCategory(chat),
    contact: { externalKey: group ? `discord-group:${chat.id}` : `discord-user:${peer?.id || chat.id}`,
      name, handle: group ? "Discord group" : peer?.username ? `@${peer.username}` : "Discord member", avatarUrl: group ? undefined : discordPhoto(peer) },
    sender: group ? { externalKey: `discord-user:${message.author.id}`, name: discordPersonName(message.author), avatarUrl: discordPhoto(message.author) } : undefined,
    replyToExternalKey: message.message_reference?.message_id ? `discord:${chat.id}:${message.message_reference.message_id}` : undefined,
    replyPreview: message.referenced_message?.content,
    replySender: message.referenced_message?.author ? discordPersonName(message.referenced_message.author) : undefined,
  };
}

export function discordRetryDelay(retryAfter: unknown, header: string | null) {
  const seconds = Math.max(Number(retryAfter) || 0, Number(header) || 0, 1);
  return Math.ceil(seconds * 1000) + 1000;
}
