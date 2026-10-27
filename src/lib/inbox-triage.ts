export type ChatKind = "all" | "direct" | "groups" | "channels";
type Chat = { platform: string; isGroup: boolean; contact: { handle: string }; lastDirection: string | null };
export function isBroadcastChannel(chat: Chat) {
  return chat.platform === "telegram" && chat.isGroup && chat.contact.handle === "Channel";
}
export function needsReply(chat: Chat) {
  return chat.lastDirection === "in" && !isBroadcastChannel(chat);
}
export function matchesChatKind(chat: Chat, kind: ChatKind) {
  if (kind === "direct") return !chat.isGroup;
  if (kind === "groups") return chat.isGroup && !isBroadcastChannel(chat);
  if (kind === "channels") return isBroadcastChannel(chat);
  return true;
}
