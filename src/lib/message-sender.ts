import type { MessageDTO } from "./types";

type SenderMessage = Pick<MessageDTO, "id" | "direction" | "senderContactId" | "senderExternalKey" | "senderHandle" | "senderName" | "senderAvatarUrl">;

// These colors identify speakers, not status. Keep each readable on both themes.
const SENDER_TONES = [
  { name: "text-blue-700 dark:text-blue-400", avatar: "bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300" },
  { name: "text-violet-700 dark:text-violet-400", avatar: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300" },
  { name: "text-rose-700 dark:text-rose-400", avatar: "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300" },
  { name: "text-teal-700 dark:text-teal-400", avatar: "bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300" },
  { name: "text-orange-700 dark:text-orange-400", avatar: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300" },
  { name: "text-fuchsia-700 dark:text-fuchsia-400", avatar: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-300" },
  { name: "text-cyan-700 dark:text-cyan-400", avatar: "bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300" },
] as const;

const UNKNOWN_TONE = {
  name: "text-slate-500 dark:text-neutral-400",
  avatar: "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-300",
};

function senderIdentity(message: SenderMessage): string | null {
  if (message.senderExternalKey?.trim()) return `external:${message.senderExternalKey.trim()}`;
  if (message.senderContactId?.trim()) return `contact:${message.senderContactId.trim()}`;
  return null;
}

export function messageSenderKey(message: SenderMessage, isGroup: boolean): string {
  if (message.direction === "out") return "self";
  if (!isGroup) return "direct-contact";
  // A display name (or generic handle) is not proof that two messages share a sender.
  return senderIdentity(message) ?? `unknown:${message.id}`;
}

export function groupMessageSender(message: SenderMessage) {
  const identity = senderIdentity(message);
  const name = message.senderName?.trim() || message.senderHandle?.trim() || "Group member";
  // FNV-1a spreads similar numeric platform IDs across the identity palette.
  let hash = 2166136261;
  for (const char of identity ?? "") hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return {
    name,
    // Never substitute the group's own picture for an unidentified person.
    avatarUrl: message.senderAvatarUrl || null,
    tone: identity ? SENDER_TONES[hash % SENDER_TONES.length] : UNKNOWN_TONE,
  };
}
