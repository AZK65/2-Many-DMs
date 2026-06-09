export type Platform = "telegram" | "whatsapp" | "x";

export type MediaType = "image" | "video" | "audio" | "sticker" | "file";

export interface InboundMessage {
  platform: Platform;
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
}

export interface SentMessage {
  messageExternalId: string;
  timestamp: string; // ISO
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
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>;
  send(chatExternalId: string, body: string): Promise<SentMessage>;
  getStatus(): AdapterStatus;
  stop(): Promise<void>;
}
