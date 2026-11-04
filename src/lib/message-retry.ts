import type { Platform } from "@/lib/platforms";
import { normalizeXMessageText } from "@/lib/x-message-text";

type RetryableMessage = {
  id?: string;
  body?: string;
  createdAt?: string | Date;
  direction?: string;
  deliveryStatus?: string | null;
  externalKey?: string | null;
  mediaType?: string | null;
};

const RETRY_SUPERSEDE_WINDOW_MS = 10 * 60_000;

function timestamp(value: string | Date | undefined): number {
  return value instanceof Date ? value.getTime() : Date.parse(value || "");
}

/**
 * Only a text-only X failure with no platform id is known to be safe to reuse.
 * Unknown deliveries must keep their original row so a late X echo can still
 * reconcile without causing a second send.
 */
export function canRetryFailedMessageInPlace(
  platform: Platform,
  message: RetryableMessage
): boolean {
  return (
    platform === "x" &&
    message.deliveryStatus === "failed" &&
    !message.externalKey &&
    !message.mediaType
  );
}

/** Find the successful resend that made an older failed X bubble obsolete. */
export function findSupersedingSentMessage<T extends RetryableMessage>(
  platform: Platform | string,
  failed: T,
  candidates: T[]
): T | undefined {
  if (
    platform !== "x" ||
    !canRetryFailedMessageInPlace("x", failed) ||
    !failed.id?.startsWith("client_") ||
    !failed.body
  ) {
    return undefined;
  }
  const failedAt = timestamp(failed.createdAt);
  if (!Number.isFinite(failedAt)) return undefined;
  const failedBody = normalizeXMessageText(failed.body);
  return candidates.find((candidate) => {
    const candidateAt = timestamp(candidate.createdAt);
    return (
      candidate.id !== failed.id &&
      candidate.direction === "out" &&
      candidate.deliveryStatus === "sent" &&
      !candidate.mediaType &&
      candidate.body != null &&
      normalizeXMessageText(candidate.body) === failedBody &&
      candidateAt > failedAt &&
      candidateAt - failedAt <= RETRY_SUPERSEDE_WINDOW_MS
    );
  });
}
