import type { MediaType } from "@/lib/types";

export const MESSAGE_PIN_CHANGED_EVENT = "omnicrm-message-pin-changed";

export type SharedMessageDTO = {
  id: string;
  body: string;
  direction: "in" | "out";
  createdAt: string;
  pinnedAt: string | null;
  mediaType: MediaType | null;
  mediaUrl: string | null;
  mediaName: string | null;
  senderName: string | null;
};

export type SharedLinkDTO = {
  id: string;
  messageId: string;
  url: string;
  body: string;
  direction: "in" | "out";
  createdAt: string;
  senderName: string | null;
};

export type SharedContentDTO = {
  pinned: SharedMessageDTO[];
  media: SharedMessageDTO[];
  links: SharedLinkDTO[];
};
