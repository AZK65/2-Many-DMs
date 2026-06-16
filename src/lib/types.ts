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
  | { id: string; type: "status"; status: "done" | "open" };

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
  message: string;
  actions: ActionStep[];
  schedule: "manual" | "daily" | "every_n_days";
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

export interface ConversationDTO {
  id: string;
  platform: Platform;
  unread: number;
  lastMessageAt: string;
  lastMessage: string | null;
  pinned: boolean;
  hidden: boolean;
  status: ConvStatus;
  snoozedUntil: string | null;
  lastOpenedAt: string | null;
  lastDirection: "in" | "out" | null;
  folderIds: string[];
  // Which of your connected accounts this chat is on (multi-account routing) —
  // lets the UI show "via …" so the same person on two accounts is distinct.
  account: { id: string; label: string | null } | null;
  contact: ContactDTO;
}

export type MediaType = "image" | "video" | "audio" | "sticker" | "file";

export interface ContactCardDTO {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  platform: Platform;
  conversationId: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  stage: string | null;
  tags: TagDTO[];
}

export interface MessageDTO {
  id: string;
  body: string;
  direction: "in" | "out";
  mediaType: MediaType | null;
  mediaUrl: string | null;
  mediaName: string | null;
  createdAt: string;
}

export const MEDIA_LABEL: Record<MediaType, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎙 Voice message",
  sticker: "Sticker",
  file: "📎 File",
};
