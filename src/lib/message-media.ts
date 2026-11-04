import type { MessageDTO } from "./types";
import { parseDeliveryIds } from "./message-delivery";

export type MessageMediaUpdate = Pick<MessageDTO,
  "id" | "externalKey" | "mediaType" | "mediaUrl" | "mediaName" | "mediaIsGif" | "editedAt" | "deletedAt">;

/** Downloads mutate old rows too, not just the newest polling window. */
export function pendingMediaIds(messages: MessageDTO[]): string[] {
  return parseDeliveryIds(messages.filter(message => message.mediaType && !message.mediaUrl &&
    message.externalKey && !message.deletedAt).map(message => message.id).slice(-50).join(","));
}

/** Partial media receipts must never overwrite text, reactions or identity. */
export function mergeMediaUpdates(messages: MessageDTO[], updates: MessageMediaUpdate[] = []): MessageDTO[] {
  const byId = new Map(updates.map(update => [update.id, update]));
  let changed = false;
  const result = messages.map(message => {
    const update = byId.get(message.id);
    if (!update?.mediaUrl || !update.mediaType || message.deletedAt || update.deletedAt ||
        message.externalKey !== update.externalKey || (message.editedAt || null) !== (update.editedAt || null)) return message;
    if (message.mediaUrl === update.mediaUrl && message.mediaType === update.mediaType &&
        message.mediaName === update.mediaName && message.mediaIsGif === update.mediaIsGif) return message;
    changed = true;
    return { ...message, mediaType: update.mediaType, mediaUrl: update.mediaUrl,
      mediaName: update.mediaName, mediaIsGif: update.mediaIsGif };
  });
  return changed ? result : messages;
}
