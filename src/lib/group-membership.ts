import type { Platform } from "./platforms";

export type MemberSelection = { contactId: string } | { target: string; expectedKey: string };
export type MemberResult = { key: string; name: string; status: "added" | "already_member" | "not_added" | "unknown"; detail: string };
export type MemberCandidate = { id: string; name: string; handle: string; avatarUrl: string | null; externalKey: string; lastMessageAt: string };
export const MAX_GROUP_ADDITIONS = 10;

export function groupMemberPolicy(platform: Platform) {
  const policies = {
    whatsapp: { direct: true, placeholder: "+1 555 123 4567", hint: "Use a phone number with its country code. Group permissions and each person’s privacy settings apply." },
    telegram: { direct: true, placeholder: "@username", hint: "Use an exact Telegram username. Group permissions and each person’s privacy settings apply." },
    x: { direct: false, placeholder: "@username", hint: "Choose people here, then open the group in X and use Add members. This connection cannot add them directly." },
    discord: { direct: false, placeholder: "Username or user ID", hint: "Choose people here, then finish in Discord. Personal search is read-only; bot connections cannot add people to private group DMs." },
    gmail: { direct: false, placeholder: "name@example.com", hint: "Email threads do not have group members. Copy these addresses into To or Cc when replying in Gmail." },
  };
  return policies[platform];
}

export function normalizeMemberTarget(platform: Platform, input: string) {
  const value = input.trim();
  if (value.length > 200) throw new Error("Enter one person at a time.");
  if (platform === "whatsapp") {
    if (!/^\+[\d ()-]+$/.test(value)) throw new Error("Include + and the country code.");
    const digits = value.replace(/\D/g, "");
    if (!/^[1-9]\d{6,14}$/.test(digits)) throw new Error("Enter a valid international phone number.");
    return `+${digits}`;
  }
  if (platform === "telegram" || platform === "x") {
    const handle = value.replace(platform === "telegram" ? /^https?:\/\/(?:www\.)?t\.me\//i : /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "");
    if (!(platform === "telegram" ? /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/ : /^[a-zA-Z0-9_]{1,15}$/).test(handle)) throw new Error("Enter an exact username, without spaces.");
    return `@${handle.toLowerCase()}`;
  }
  if (platform === "gmail") {
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value)) throw new Error("Enter one email address.");
    return value.toLowerCase();
  }
  if (!/^(?:\d{15,22}|[a-zA-Z0-9_.]{2,32}(?:#\d{4})?)$/.test(value)) throw new Error("Enter a Discord username or numeric user ID.");
  return value;
}

export function groupSourceUrl(platform: Platform, externalId: string) {
  if (platform === "x" && /^[a-zA-Z0-9_-]+$/.test(externalId)) return `https://x.com/i/chat/${externalId}`;
  // Server channels require a guild ID which the conversation does not retain.
  if (platform === "discord") return "https://discord.com/channels/@me";
  if (platform === "gmail") return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(externalId)}`;
  return platform === "telegram" ? "https://web.telegram.org/" : "https://web.whatsapp.com/";
}

/** Scope contacts to the exact account; a shared platform prefix isn't enough. */
export function groupContactScope(accountId: string, platform: string) {
  return { isGroup: false, externalKey: { startsWith: `${platform}:` }, OR: [
    { conversations: { some: { accountId, platform } } },
    { sentMessages: { some: { conversation: { accountId, platform } } } },
  ] };
}
