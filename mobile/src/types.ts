export type Platform = "x" | "whatsapp" | "telegram" | "discord" | "gmail";

export type ConversationStatus = "open" | "waiting" | "done";
export type ConversationIntent = "normal" | "prospect" | "onboarding" | "support";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Contact {
  id: string;
  name: string;
  handle: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage: string | null;
  avatarUrl: string | null;
  tags: Tag[];
}

export interface Conversation {
  id: string;
  platform: Platform;
  externalId: string | null;
  unread: number;
  lastMessageAt: string;
  lastMessage: string | null;
  lastDirection: "in" | "out" | null;
  pinned: boolean;
  hidden: boolean;
  inboxCategory: "general" | "spam";
  status: ConversationStatus;
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
  folderIds: string[];
  account: {
    id: string;
    label: string | null;
    driver: string | null;
    status: string;
  } | null;
  isGroup: boolean;
  topicOf: string | null;
  contact: Contact;
}

export interface Message {
  id: string;
  body: string;
  originalBody?: string | null;
  translatedBody?: string | null;
  direction: "in" | "out";
  mediaType: "image" | "video" | "audio" | "sticker" | "file" | null;
  mediaUrl: string | null;
  mediaName: string | null;
  createdAt: string;
  replyToExternalKey: string | null;
  replyPreview: string | null;
  replySender: string | null;
  deliveryStatus?: "sending" | "pending" | "sent" | "unconfirmed" | "failed";
  deliveryError?: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  senderTags: Tag[];
  reactions?: { emoji: string; count: number; who: string[] }[];
}

export interface ContactCard {
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
  tags: Tag[];
}

export interface TodoTask {
  id: string;
  title: string;
  note: string | null;
  priority: boolean;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "keyword" | "no_reply" | "unanswered" | "new_chat" | "broadcast";
  keyword: string | null;
  noReplyDays: number | null;
  platform: Platform | null;
  schedule: "instant" | "manual" | "daily" | "every_n_days";
  everyNDays: number | null;
  cooldownDays: number;
  lastRunAt: string | null;
  matchCount: number;
}

export interface Account {
  id: string;
  platform: Platform;
  label: string | null;
  status: string;
  detail: string | null;
  driver: string | null;
  proxyRegion: string | null;
}

export interface SocialLead {
  id: string;
  kind: "lead" | "support";
  postId: string;
  watcher: string | null;
  username: string;
  displayName: string | null;
  bio: string | null;
  followers: string | null;
  content: string;
  url: string;
  matchedQuery: string | null;
  tier: "HOT" | "WARM" | "REJECT";
  reason: string | null;
  status: "new" | "contacted" | "ignored";
  rating: "good" | "bad" | null;
  postedAt: string | null;
  receivedAt: string;
}

export interface ListeningResponse {
  leads: SocialLead[];
  counts: {
    hot: number;
    warm: number;
    rejected: number;
    support: number;
    supportNew: number;
  };
  lastRun: { createdAt: string; found: number; fresh: number } | null;
}

export interface HealthResponse {
  ok: true;
  service: "omni-crm";
  apiVersion: number;
  serverTime: string;
  database: "ready";
  tailscaleUser: { login: string | null; name: string | null } | null;
  capabilities: string[];
}

export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
}
