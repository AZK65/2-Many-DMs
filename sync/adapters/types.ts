export type Platform = "telegram" | "whatsapp" | "x" | "discord" | "gmail";

export type MediaType = "image" | "video" | "audio" | "sticker" | "file";

export type AvatarRefreshResult = { url?: string; source: "downloaded" | "cached" | "unavailable" };

export interface InboundMessage {
  platform: Platform;
  accountId?: string; // which connected Account this message belongs to (injected by the worker)
  chatExternalId: string; // platform conversation/peer id (used to route replies)
  messageExternalId: string; // globally-unique message key, e.g. "telegram:<chat>:<id>"
  direction: "in" | "out";
  body: string;
  timestamp: Date;
  // X used import-time placeholders in older versions. A native date allows
  // the store to correct those rows in place without treating them as new DMs.
  timestampVerified?: boolean;
  // History imports must not increment unread counts or fire live-message
  // automations. Connectors set this for explicit/initial backfills.
  historical?: boolean;
  // An exact native edit event, not an inferred text match.
  sourceEdited?: boolean;
  // True when the native platform says this account was directly mentioned.
  // The inbox keeps this as a durable unread signal until the chat is opened.
  mentionsMe?: boolean;
  media?: {
    type: MediaType;
    url: string | null; // null when skipped (e.g. file over the size cap)
    name?: string;
    isGif?: boolean; // native animation marker; never infer from silence/duration
  };
  contact: {
    externalKey: string; // stable per-platform user key, e.g. "telegram:123"
    name: string;
    handle: string;
    avatarUrl?: string; // served path like "/avatars/telegram_123.jpg"
  };
  isGroup?: boolean; // the `contact` is a group chat
  inboxCategory?: "general" | "spam"; // source inbox classification (X / Discord requests)
  // For inbound group messages: the member who actually sent it (so their tags
  // can show). Their externalKey matches their 1:1 contact when one exists.
  sender?: {
    externalKey: string;
    name: string;
    avatarUrl?: string;
  };
  // People tagged in a group message may not have spoken yet. Saving their
  // native identity lets the UI show a real name and open a private chat.
  mentionedContacts?: {
    externalKey: string;
    name: string;
    handle: string;
    avatarUrl?: string;
  }[];
  // Native quoted-message context. The store can fill the preview and sender
  // from an already-synced target when an adapter only exposes its ID.
  replyToExternalKey?: string;
  replyPreview?: string;
  replySender?: string;
}

export interface SentMessage {
  messageExternalId: string;
  timestamp: string; // ISO
}

export interface ResolvedDirectContact {
  chatExternalId: string;
  externalKey: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  /** Equivalent IDs verified by the platform, not inferred from a name. */
  aliases?: string[];
}

export type DirectContactContext = { groupExternalId?: string; senderMessageExternalId?: string };

export type GroupParticipantStatus = "added" | "invite_sent" | "not_added";

export interface GroupParticipantOutcome {
  participantKey: string;
  status: GroupParticipantStatus;
  detail?: string;
}

export interface CreateGroupResult {
  chatExternalId: string;
  initialMessageSent?: boolean;
  inviteUrl?: string;
  participantOutcomes: GroupParticipantOutcome[];
}

export interface OutboundReaction {
  emoji: string;
  remove?: boolean;
  // WhatsApp message keys need to know whether the target came from this
  // account. Group messages can also require the original participant JID.
  fromMe?: boolean;
  senderExternalKey?: string;
}

// An attachment to send out, resolved to an absolute path on the shared disk.
export interface OutboundMedia {
  type: MediaType;
  path: string; // absolute filesystem path under public/media
  name: string;
  mime?: string;
}

export interface OutboundSendContext {
  // X separates accepted chats from message requests. Passing the CRM's known
  // category lets the browser open the correct native route immediately.
  inboxCategory?: "general" | "spam";
}

export interface ArchiveChatContext {
  // WhatsApp's multi-device archive mutation must be anchored to the latest
  // known message. Other connectors can ignore this context.
  lastMessageId?: string;
  lastMessageTimestamp?: number;
  lastMessageFromMe?: boolean;
  lastMessageParticipant?: string;
}

export type AdapterState =
  | "starting"
  | "qr"
  | "ready"
  | "disconnected"
  | "disabled";

export interface AdapterStatus {
  platform: Platform;
  state: AdapterState;
  qr?: string | null; // PNG data URL when state === 'qr'
  detail?: string; // e.g. "@username" or connected phone number
  sync?: import("../../src/lib/sync-health").SyncHealth;
}

/**
 * An emoji reaction arriving from a platform.
 *
 * Keyed by the same messageExternalId the message was stored under, so a
 * reaction on a message we never synced is simply dropped.
 *
 * Platforms differ on removal: some send an explicit remove, others send the
 * actor's full current emoji set (empty = they cleared it). `emojis` carries
 * the whole set when a platform works that way; `emoji` + `removed` covers the
 * add/remove style.
 */
export interface InboundReaction {
  platform: Platform;
  accountId?: string;
  messageExternalId: string;
  actor: { externalKey: string; name?: string };
  emoji?: string;
  removed?: boolean;
  emojis?: string[]; // authoritative full set for this actor, if known
  // Aggregate counts, for platforms that report totals without identities
  // (large Telegram channels). Stored under the "aggregate" actor.
  counts?: { emoji: string; count: number }[];
}

export interface Adapter {
  platform: Platform;
  editMessage?(chatExternalId: string, messageExternalId: string, body: string): Promise<void>;
  deleteMessage?(chatExternalId: string, messageExternalId: string): Promise<void>;
  start(
    onMessage: (m: InboundMessage) => Promise<void>,
    // Called when a chat is read on the platform (e.g. on the phone) so the
    // inbox can clear its unread badge.
    onRead?: (chatExternalId: string) => Promise<void>,
    // Emoji reactions added or removed on an already-synced message.
    onReaction?: (r: InboundReaction) => Promise<void>
  ): Promise<void>;
  send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia,
    mentions?: string[],
    replyToExternalId?: string,
    context?: OutboundSendContext
  ): Promise<SentMessage>;
  // Add or remove this account's reaction on an already-synced message.
  react?(
    chatExternalId: string,
    messageExternalId: string,
    reaction: OutboundReaction
  ): Promise<void>;
  // Verify or restore the transport before an outbound operation. Adapters
  // without a cheap health check may omit this and rely on getStatus().
  ensureReady?(): Promise<void>;
  // Called after an operation deadline. It must recover the transport without
  // retrying the message itself, because delivery may already have happened.
  recover?(): Promise<void>;
  // Refresh an unlinked account's QR without logging out or deleting sessions.
  refreshQr?(): Promise<void>;
  // Marks a chat as read on the platform (when the user opens it in the inbox).
  markRead?(
    chatExternalId: string,
    context?: OutboundSendContext
  ): Promise<void>;
  // Keep the source app and Omni in sync for the inbox-clearing action. This
  // is deliberately separate from `hidden`, which classifies non-clients.
  setArchivedAndMuted?(
    chatExternalId: string,
    archived: boolean,
    context?: ArchiveChatContext
  ): Promise<void>;
  // Ask platforms that support it to deliver messages older than a known key.
  requestHistory?(
    chatExternalId: string,
    oldestMessageId: string,
    oldestTimestamp: number,
    count?: number,
    context?: {
      isGroup?: boolean;
      inboxCategory?: "general" | "spam";
      sinceTimestamp?: number;
      anchorFromMe?: boolean;
    }
  ): Promise<void>;
  // Re-fetch one known message with its binary attachment. This is separate
  // from history backfill so a recent missing video is not skipped by an
  // "older than the oldest message" cursor.
  recoverMedia?(
    chatExternalId: string,
    messageExternalId: string,
    options?: { automatic?: boolean }
  ): Promise<void>;
  // Create a group with the given members (by their contact externalKeys) and
  // return the new chat's externalId. Optional — not every platform supports it.
  createGroup?(
    name: string,
    participantKeys: string[],
    firstMessage?: string
  ): Promise<CreateGroupResult>;
  // Resolve one exact platform recipient before the CRM creates a new empty
  // conversation. This is intentionally read-only: nothing is sent until the
  // normal composer calls send().
  resolveDirectContact?(target: string, context?: DirectContactContext): Promise<ResolvedDirectContact>;
  // Photo-only work: never fetch message history, mark read, or send anything.
  refreshAvatar?(chatExternalId: string, isGroup: boolean, context?: DirectContactContext): Promise<AvatarRefreshResult>;
  getStatus(): AdapterStatus;
  stop(): Promise<void>;
}
