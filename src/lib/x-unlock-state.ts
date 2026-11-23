/** X's Chat PIN is four digits, including any leading zero. */
export const X_CHAT_PIN_LENGTH = 4;
export const isXChatPin = (value: unknown): value is string => typeof value === "string" && /^\d{4}$/.test(value);

export type XUnlockState = {
  state: "required" | "verifying" | "rejected" | "error" | "unlocked" | "login-required";
  detail: string;
  startedAt?: number;
  updatedAt?: number;
};

/** Polling can lag behind a completed request; old results must not mask a
 * later successful unlock either. Prefer the most recent server observation. */
export function latestXUnlockState(live?: XUnlockState, result?: XUnlockState | null) {
  if (!result) return live;
  if (!live) return result;
  return (live.updatedAt ?? live.startedAt ?? 0) > (result.updatedAt ?? result.startedAt ?? 0) ? live : result;
}

export const X_UNLOCK_UI_TIMEOUT_MS = 60_000;
export function xUnlockCheckExpired(startedAt: number, now: number) {
  return startedAt > 0 && now - startedAt >= X_UNLOCK_UI_TIMEOUT_MS;
}

export function xNeedsUnlock(status?: { detail?: string | null; unlock?: XUnlockState }) {
  if (status?.unlock?.state === "login-required") return false;
  return Boolean(status?.unlock && status.unlock.state !== "unlocked") ||
    /locked|passcode/i.test(status?.detail || "");
}

export function xInboxVerified(status?: { state: string; unlock?: XUnlockState; sync?: { lastCheckedAt?: number; retryAt?: number } }) {
  return status?.state === "ready" && !(status.sync?.retryAt && status.sync.retryAt > Date.now()) &&
    (status.unlock?.state === "unlocked" || (!status.unlock && Boolean(status.sync?.lastCheckedAt)));
}
