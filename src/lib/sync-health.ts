// Connection health and message coverage are deliberately separate. A socket
// being ready does not establish that a conversation's history is complete.
export type ChatSyncIssue = {
  externalId: string;
  state: "queued" | "blocked";
  retryAt?: number;
};

export type SyncHealth = {
  lastCheckedAt?: number;
  lastMessageAt?: number;
  pendingChats: number;
  blockedChats: number;
  retryAt?: number;
  chats?: ChatSyncIssue[];
};

export type SyncStatus = {
  platform: string;
  state: string;
  detail?: string;
  sync?: SyncHealth;
};

export function syncHealthView(status?: SyncStatus, now = Date.now()) {
  const health = status?.sync;
  const paused = Boolean(health?.retryAt && health.retryAt > now);
  if (!status || status.state === "disabled") return { label: "Status unavailable", tone: "attention", detail: "Message coverage could not be checked." } as const;
  if (paused) return { label: "Sync paused", tone: "attention", detail: "Automatic recovery is waiting for the platform. Saved messages remain available." } as const;
  if (status.state !== "ready") return { label: status.state === "qr" ? "Scan QR" : status.state === "starting" ? "Connecting" : "Needs attention", tone: "attention", detail: "New messages may be delayed. Saved history remains available." } as const;
  if (health?.blockedChats) return { label: "History needs attention", tone: "attention", detail: `${health.blockedChats} chats waiting to retry; ${health.pendingChats} queued for history checks.` } as const;
  if (health?.lastCheckedAt && now - health.lastCheckedAt > 15 * 60_000) return { label: "Checks delayed", tone: "attention", detail: "Connected, but the last successful inbox check is over 15 minutes old." } as const;
  if (health?.pendingChats) return { label: "Checking history", tone: "progress", detail: `${health.pendingChats} chats queued. Live messages and older history are checked separately.` } as const;
  if (health?.lastCheckedAt) return { label: "Recent inbox checked", tone: "success", detail: "No known pending history checks. This does not guarantee all older messages or attachments are available." } as const;
  return { label: "Connected · history unverified", tone: "neutral", detail: "The connection is live; complete history has not been verified." } as const;
}

export function chatSyncIssue(externalId: string | null, health?: SyncHealth) {
  if (!externalId) return undefined;
  // Telegram checkpoints use peer kinds while Omni routes numeric IDs. Forum
  // topics share the parent channel's recovery state.
  const id = externalId.replace(/__t\d+$/, "");
  return health?.chats?.find(chat => chat.externalId === id);
}

export function sourceChatUrl(conversation: { platform: string; externalId: string | null; inboxCategory: string; isGroup: boolean; contact: { handle: string } }) {
  const id = conversation.externalId;
  if (!id) return null;
  if (conversation.platform === "x" && /^[a-zA-Z0-9_-]+$/.test(id)) return `https://x.com/i/chat/${conversation.inboxCategory === "spam" ? "requests/" : ""}${id}`;
  if (conversation.platform === "telegram") return "https://web.telegram.org/";
  if (conversation.platform === "whatsapp") return "https://web.whatsapp.com/";
  return null;
}
