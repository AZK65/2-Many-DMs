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
  notes: string | null;
  avatarUrl: string | null;
  tags: TagDTO[];
}

export interface FolderDTO {
  id: string;
  name: string;
}

export interface ConversationDTO {
  id: string;
  platform: Platform;
  unread: number;
  lastMessageAt: string;
  lastMessage: string | null;
  pinned: boolean;
  hidden: boolean;
  folderIds: string[];
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
