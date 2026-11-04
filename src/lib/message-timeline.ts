import type { MessageDTO } from "./types";
import { mergeDelivery } from "./message-delivery";
import { mergeMediaUpdates } from "./message-media";
import { isNativeXMessageKey, normalizeXMessageText, xPreviewMatchesText } from "./x-message-text";
import { findSupersedingSentMessage } from "./message-retry";

function timestamp(message: MessageDTO): number {
  const value = Date.parse(message.createdAt);
  return Number.isFinite(value) ? value : Infinity;
}

/** Stable ties retain platform order (X can only expose minute precision). */
export function orderMessageWindow(messages: MessageDTO[]): MessageDTO[] {
  const ordered = [...messages].sort((a, b) => timestamp(a) - timestamp(b));
  return ordered.every((message, index) => message === messages[index]) ? messages : ordered;
}

/** Polls, backfills and overlapping pages are updates, not append-only events. */
export function mergeMessageWindow(current: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  const rows = new Map<string, MessageDTO>();
  for (const candidate of [...current, ...incoming]) {
    const previous = rows.get(candidate.id);
    let next = previous ? mergeDelivery(previous, candidate) : candidate;
    if (previous && (previous.deletedAt ||
        (Date.parse(previous.editedAt || "") || 0) > (Date.parse(candidate.editedAt || "") || 0))) next = previous;
    // A response started before preview promotion can finish after it. Never
    // downgrade the SAME row from a verified message back to a clipped snapshot.
    if (previous && isNativeXMessageKey(previous.externalKey) && candidate.externalKey?.startsWith("x:preview:")) {
      next = previous;
    }
    // An overlapping poll begun before download completion must not revert
    // the same unchanged message to its missing-attachment placeholder.
    if (previous?.mediaUrl && !next.mediaUrl) next = mergeMediaUpdates([next], [previous])[0];
    rows.set(candidate.id, previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }
  const ordered = orderMessageWindow([...rows.values()]);
  return ordered.length === current.length && ordered.every((row, index) => row === current[index]) ? current : ordered;
}

function plainPreview(message: MessageDTO): boolean {
  // A durable local send can acquire a preview key as its receipt. It is NOT
  // an inbox snapshot. Also keep annotated snapshots available for their data.
  return Boolean(message.externalKey?.startsWith("x:preview:") && !message.id.startsWith("client_") &&
    message.body.trim() && Number.isFinite(timestamp(message)) && !message.mediaType && !message.mediaUrl && !message.pinnedAt &&
    !message.originalBody && !message.translatedBody && !message.reactions?.length && !message.replyToExternalKey);
}

/**
 * Presentation only, for ONE conversation/account. No records are deleted.
 * Inbox snapshots are not separate message events; show the native message as
 * soon as it loads, without waiting for a background repair or the next poll.
 * Every distinct native ID survives, including genuinely repeated text.
 */
export function projectMessageTimeline(raw: MessageDTO[], platform: string): {
  messages: MessageDTO[];
  aliases: Map<string, string>;
} {
  const ordered = mergeMessageWindow([], raw);
  const aliases = new Map<string, string>();
  if (platform !== "x") return { messages: ordered, aliases };

  const natives = ordered.filter(message => isNativeXMessageKey(message.externalKey));
  const previousByDirection = new Map<string, MessageDTO>();
  const messages: MessageDTO[] = [];
  for (const message of ordered) {
    const successfulRetry = findSupersedingSentMessage("x", message, ordered);
    if (successfulRetry) {
      aliases.set(message.id, successfulRetry.id);
      continue;
    }
    if (plainPreview(message)) {
      const nativeMatches = natives.filter(native => native.direction === message.direction &&
        !native.mediaType && !native.mediaUrl && xPreviewMatchesText(message.body, native.body));
      // A clipped preview shared by DIFFERENT full messages is ambiguous.
      const distinctBodies = new Set(nativeMatches.map(native => normalizeXMessageText(native.body)));
      const sameDirection = natives.filter(native => native.direction === message.direction);
      // Preview clocks are observations and may drift by hours. Still do not
      // jump over a different incoming message or suppress a genuinely future
      // native event (allow only the existing two-minute rounding tolerance).
      const anchor = sameDirection.filter(native => timestamp(native) <= timestamp(message)).at(-1) ??
        sameDirection.find(native => timestamp(native) <= timestamp(message) + 130_000);
      if (distinctBodies.size === 1 && anchor && nativeMatches.includes(anchor)) {
        aliases.set(message.id, anchor.id);
        continue;
      }
      const previous = previousByDirection.get(message.direction);
      if (previous && plainPreview(previous) && normalizeXMessageText(previous.body) === normalizeXMessageText(message.body)) {
        aliases.set(message.id, previous.id);
        continue;
      }
    }
    messages.push(message);
    previousByDirection.set(message.direction, message);
  }
  return { messages, aliases };
}
