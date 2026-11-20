/** X's Chat PIN is four digits, including any leading zero. */
export const X_CHAT_PIN_LENGTH = 4;
export const isXChatPin = (value: unknown): value is string => typeof value === "string" && /^\d{4}$/.test(value);

export type XUnlockState = {
  state: "required" | "verifying" | "rejected" | "error" | "unlocked" | "login-required";
  detail: string;
  startedAt?: number;
};

export function xNeedsUnlock(status?: { detail?: string | null; unlock?: XUnlockState }) {
  if (status?.unlock?.state === "login-required") return false;
  return Boolean(status?.unlock && status.unlock.state !== "unlocked") ||
    /locked|passcode/i.test(status?.detail || "");
}

export function xInboxVerified(status?: { state: string; unlock?: XUnlockState; sync?: { lastCheckedAt?: number; retryAt?: number } }) {
  return status?.state === "ready" && !(status.sync?.retryAt && status.sync.retryAt > Date.now()) &&
    (status.unlock?.state === "unlocked" || (!status.unlock && Boolean(status.sync?.lastCheckedAt)));
}
