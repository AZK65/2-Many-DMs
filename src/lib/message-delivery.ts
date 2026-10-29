import type { MessageDTO } from "./types";

type Delivery = Pick<MessageDTO, "id" | "direction" | "deliveryStatus" | "deliveryError" | "externalKey" | "createdAt">;

/** A queued HTTP snapshot must not undo a receipt delivered by a faster poll. */
export function mergeDelivery<T extends Delivery>(current: T, incoming: T): T {
  if (current.id !== incoming.id || current.direction !== "out") return incoming;
  const waiting = incoming.deliveryStatus === "pending" || incoming.deliveryStatus === "sending";
  const resolved = ["sent", "failed", "unconfirmed"].includes(current.deliveryStatus || "");
  const nativeReceipt = current.deliveryStatus === "sent" && current.externalKey &&
    !current.externalKey.includes(":pending:") && !current.externalKey.includes(":preview:");
  if ((waiting && resolved) || (nativeReceipt && incoming.deliveryStatus !== "sent")) {
    return { ...incoming, deliveryStatus: current.deliveryStatus, deliveryError: current.deliveryError, externalKey: current.externalKey, createdAt: current.createdAt };
  }
  return incoming;
}

/** Keep checking unresolved sends even after a busy chat moves them out of its latest page. */
export function deliveryIds(messages: Delivery[]): string[] {
  return messages.filter(message => message.direction === "out" &&
    (["sending", "pending", "unconfirmed"].includes(message.deliveryStatus || "") ||
      message.externalKey?.includes(":pending:")))
    .slice(-50).map(message => message.id);
}

export function parseDeliveryIds(raw: string | null): string[] {
  return [...new Set((raw || "").split(",").filter(id => /^[a-zA-Z0-9_-]{1,160}$/.test(id)))].slice(0, 50);
}

/** A delivery-only refresh must not erase reactions, media, or sender metadata. */
export function mergeDeliveryReceipt(current: MessageDTO, receipt: MessageDTO): MessageDTO {
  return mergeDelivery(current, { ...current,
    externalKey: receipt.externalKey,
    createdAt: receipt.createdAt,
    deliveryStatus: receipt.deliveryStatus,
    deliveryError: receipt.deliveryError,
  });
}
