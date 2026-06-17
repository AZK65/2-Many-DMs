export type Platform = "telegram" | "whatsapp" | "x";

export type MediaType = "image" | "video" | "audio" | "sticker" | "file";

export interface InboundMessage {
  platform: Platform;
  accountId?: string; // which connected Account this message belongs to (injected by the worker)
  chatExternalId: string; // platform conversation/peer id (used to route replies)
  messageExternalId: string; // globally-unique message key, e.g. "telegram:<chat>:<id>"
  direction: "in" | "out";
  body: string;
  timestamp: Date;
  media?: {
    type: MediaType;
    url: string | null; // null when skipped (e.g. file over the size cap)
    name?: string;
  };
  contact: {
    externalKey: string; // stable per-platform user key, e.g. "telegram:123"
    name: string;
    handle: string;
    avatarUrl?: string; // served path like "/avatars/telegram_123.jpg"
  };
  isGroup?: boolean; // the `contact` is a group chat
  // For inbound group messages: the member who actually sent it (so their tags
  // can show). Their externalKey matches their 1:1 contact when one exists.
  sender?: {
    externalKey: string;
    name: string;
    avatarUrl?: string;
  };
}

export interface SentMessage {
  messageExternalId: string;
  timestamp: string; // ISO
}

// An attachment to send out, resolved to an absolute path on the shared disk.
export interface OutboundMedia {
  type: MediaType;
  path: string; // absolute filesystem path under public/media
  name: string;
  mime?: string;
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
}

export interface Adapter {
  platform: Platform;
  start(
    onMessage: (m: InboundMessage) => Promise<void>,
    // Called when a chat is read on the platform (e.g. on the phone) so the
    // inbox can clear its unread badge.
    onRead?: (chatExternalId: string) => Promise<void>
  ): Promise<void>;
  send(
    chatExternalId: string,
    body: string,
    media?: OutboundMedia
  ): Promise<SentMessage>;
  // Marks a chat as read on the platform (when the user opens it in the inbox).
  markRead?(chatExternalId: string): Promise<void>;
  getStatus(): AdapterStatus;
  stop(): Promise<void>;
}
