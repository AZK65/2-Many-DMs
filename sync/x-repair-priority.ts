import type { XLatestPreview } from "./x-history";

export const X_RECENT_CHAT_AGE_MS = 7 * 24 * 60 * 60_000;
export const X_RECENT_REPAIR_PACE_MS = 10_000;

export type XRepairPriority = {
  previewKey: string;
  activityAt?: number;
  attempts: number;
  live?: boolean;
  latest?: XLatestPreview;
  recentKey?: string;
  recentAt?: number;
  recentAttempts?: number;
  recentRetryAt?: number;
};

export function needsXRecentHistory(repair: XRepairPriority, now = Date.now()) {
  return Boolean(repair.activityAt && repair.activityAt >= now - X_RECENT_CHAT_AGE_MS &&
    repair.recentKey !== repair.previewKey);
}

// Recover the expected head from older durable jobs without trusting an import
// time or the current viewport. Message text may itself contain colons/URLs.
export function xRepairLatest(repair: XRepairPriority): XLatestPreview | undefined {
  if (repair.latest) return repair.latest;
  const match = /^(?:media-v2:|media-recovery:)?(in|out):([\s\S]*):(\d+|undated)$/.exec(repair.previewKey);
  if (!match) return undefined;
  return { direction: match[1] as "in" | "out", preview: match[2], timestamp: match[3] === "undated" ? undefined : Number(match[3]) };
}

export function nextXRepair<T extends XRepairPriority>(
  queue: Map<string, T>, retryAt: Map<string, number>, now = Date.now()
): { key: string; repair: T; phase: "recent" | "history" } | undefined {
  const entries = [...queue.entries()];
  // First give every active chat a readable recent window, newest first. An
  // old attachment's retry deadline does not block this independent text read.
  const recent = entries.filter(([, r]) => needsXRecentHistory(r, now) && (r.recentRetryAt || 0) <= now)
    .sort((a, b) => (b[1].activityAt || 0) - (a[1].activityAt || 0))[0];
  if (recent) return { key: recent[0], repair: recent[1], phase: "recent" };
  const active = (r: T) => Boolean(r.activityAt && r.activityAt >= now - X_RECENT_CHAT_AGE_MS);
  const history = entries.filter(([key, r]) => (retryAt.get(key) || 0) <= now &&
    // Don't retry a failed recent read immediately under a different label.
    !(needsXRecentHistory(r, now) && (r.recentRetryAt || 0) > now))
    .sort((a, b) => Number(active(b[1])) - Number(active(a[1])) ||
      a[1].attempts - b[1].attempts ||
      (b[1].activityAt || 0) - (a[1].activityAt || 0) ||
      Number(Boolean(b[1].live)) - Number(Boolean(a[1].live)))[0];
  return history ? { key: history[0], repair: history[1], phase: "history" } : undefined;
}
