import type { Platform } from "./platforms";

export interface TagDTO {
  id: string;
  name: string;
  color: string;
}

export interface ContactDTO {
  id: string;
  name: string;
  handle: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage: string | null;
  avatarUrl: string | null;
  tags: TagDTO[];
}

export interface FolderDTO {
  id: string;
  name: string;
}

export type ActionStep =
  | { id: string; type: "send"; message: string }
  | { id: string; type: "tag"; tagId: string }
  | { id: string; type: "status"; status: "done" | "open" }
  | { id: string; type: "intent"; intent: ConversationIntent }
  | { id: string; type: "follow_up"; days: number };

export type ConversationIntent = "normal" | "prospect" | "onboarding" | "support";

export interface AutomationDTO {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "keyword" | "no_reply" | "unanswered" | "new_chat" | "broadcast";
  keyword: string | null;
  noReplyDays: number | null;
  platform: Platform | null;
  tagId: string | null;
  folderId: string | null;
  intent: ConversationIntent | null;
  message: string;
  actions: ActionStep[];
  schedule: "instant" | "manual" | "daily" | "every_n_days";
  everyNDays: number | null;
  cooldownDays: number;
  lastRunAt: string | null;
  matchCount: number;
}

export interface AutomationMatchDTO {
  conversationId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  platform: Platform;
  lastMessage: string | null;
  preview: string; // the rendered message this contact would receive
}

export interface KeywordAlertDTO {
  id: string;
  conversationId: string | null;
  scope: "conversation" | "all_groups";
  phrases: string[];
  enabled: boolean;
  groupName: string | null;
  updatedAt: string;
}

export interface KeywordNotificationDTO {
  id: string;
  alertId: string;
  messageId: string;
  conversationId: string;
  groupName: string;
  senderName: string | null;
  preview: string;
  matchedPhrase: string;
  createdAt: string;
  readAt: string | null;
}

export interface SnippetDTO {
  id: string;
  title: string;
  text: string;
  shortcut: string | null;
}

export interface RelationDTO {
  id: string;
  label: string | null;
  conversationId: string;
  contactName: string;
  handle: string;
  avatarUrl: string | null;
  platform: Platform;
}

export type ConvStatus = "open" | "waiting" | "done";

// Observed inbound senders, not a claim of a complete/current group roster.
export interface GroupPreviewDTO {
  count: number;
  members: { id: string; name: string; avatarUrl: string | null }[];
}

export interface ConversationAppearanceDTO {
  id: string;
  avatarUrl: string | null;
  groupPreview: GroupPreviewDTO | null;
}

export interface ConversationDTO {
  id: string;
  platform: Platform;
  externalId: string | null;
  unread: number;
  hasUnreadMention: boolean;
  lastMessageAt: string;
  lastMessage: string | null;
  pinned: boolean;
  lastMessageDelivery?: string | null;
  previewOnly?: boolean;
  hidden: boolean;
  archived: boolean;
  inboxCategory: "general" | "spam";
  status: ConvStatus;
  intent: ConversationIntent;
  followUpAt: string | null;
  snoozedUntil: string | null;
  lastOpenedAt: string | null;
  priority: boolean;
  todo: boolean;
  todoNote: string | null;
  todoCompleted: boolean;
  todoAddedAt: string | null;
  translationEnabled: boolean;
  translationLanguageCode: string | null;
  translationLanguageName: string | null;
  lastDirection: "in" | "out" | null;
  folderIds: string[];
  // Which of your connected accounts this chat is on (multi-account routing) —
  // lets the UI show "via …" so the same person on two accounts is distinct.
  account: {
    id: string;
    label: string | null;
    driver: string | null;
    status: string;
  } | null;
  isGroup: boolean;
  groupPreview?: GroupPreviewDTO | null;
  // For forum topics: the parent channel's externalId (so the inbox can nest
  // topics as subchats). Null for everything else.
  topicOf: string | null;
  contact: ContactDTO;
}

// The inbox polls frequently for live message and triage changes. Contact,
// folder, and account metadata are intentionally omitted because they are
// loaded once with the full conversation snapshot.
export type ConversationPollDTO = Pick<
  ConversationDTO,
  | "id"
  | "unread"
  | "hasUnreadMention"
  | "lastMessageAt"
  | "lastMessage"
  | "archived"
  | "inboxCategory"
  | "status"
  | "followUpAt"
  | "snoozedUntil"
  | "lastOpenedAt"
  | "lastDirection"
  | "lastMessageDelivery"
  | "previewOnly"
>;

export type MediaType = "image" | "video" | "audio" | "sticker" | "file";

export interface ContactCardDTO {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  platform: Platform;
  conversationId: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  stage: string | null;
  tags: TagDTO[];
  emailActivity: EmailActivityDTO | null;
}

export interface EmailActivityDTO {
  email: string;
  firstCopiedAt: string;
  lastCopiedAt: string;
  copyCount: number;
  sourceApp: string | null;
  matchCount: number;
}

export interface MessageDTO {
  id: string;
  // Stable platform message key. Reply previews use this to jump back to the
  // exact original message even when it is outside the loaded thread window.
  externalKey?: string | null;
  body: string;
  originalBody?: string | null;
  translatedBody?: string | null;
  translationSourceLanguage?: string | null;
  translationTargetLanguage?: string | null;
  direction: "in" | "out";
  mediaType: MediaType | null;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaIsGif?: boolean;
  pinnedAt?: string | null;
  createdAt: string;
  replyToExternalKey: string | null;
  replyPreview: string | null;
  replySender: string | null;
  // `sending` only exists during the optimistic browser request. Every other
  // state is durable and survives refreshes/restarts.
  deliveryStatus?: "sending" | "pending" | "sent" | "unconfirmed" | "failed";
  deliveryError?: string | null;
  // For group messages: who sent it + their tags (so the UI can show them).
  senderContactId?: string | null;
  senderHandle?: string | null;
  senderExternalKey?: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  senderTags: TagDTO[];
  // WhatsApp group mention id -> CRM display name. The stored body remains
  // untouched so replies/forwarding still carry the platform's original text.
  mentionNames?: Record<string, string>;
  mentionTargets?: Record<string, string>;
  // Emoji reactions, already grouped by emoji with counts summed.
  reactions?: { emoji: string; count: number; who: string[] }[];
}

export const MEDIA_LABEL: Record<MediaType, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎙 Voice message",
  sticker: "Sticker",
  file: "📎 File",
};
