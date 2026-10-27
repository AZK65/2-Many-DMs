export type SetupError = { error: string; action?: "restart" | "credentials"; retryAfter?: number };

export function normalizeTelegramPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}
export function telegramCredentials(apiId: unknown, apiHash: unknown) {
  const id = Number(apiId);
  const hash = typeof apiHash === "string" ? apiHash.trim() : "";
  return Number.isSafeInteger(id) && id > 0 && /^[a-f0-9]{32}$/i.test(hash)
    ? { apiId: id, apiHash: hash } : null;
}
/** Never expose raw provider errors, which may contain user inputs. */
export function telegramSetupError(cause: unknown): SetupError {
  const e = cause as { errorMessage?: string; message?: string; seconds?: number };
  const message = e?.errorMessage || e?.message || "";
  if (/FLOOD|too many/i.test(message)) {
    const seconds = Number(e?.seconds) || Number(message.match(/WAIT_?(\d+)/)?.[1]) || 60;
    return { error: "Telegram has paused login attempts. Wait for the timer before trying again.", retryAfter: Math.max(1, Math.min(seconds, 86400)) };
  }
  if (/API_ID|API_HASH/.test(message)) return { error: "Telegram did not accept the app credentials. Copy the API ID and API hash from API development tools.", action: "credentials" };
  if (/PHONE_NUMBER_INVALID/.test(message)) return { error: "Check the phone number and include its country code, starting with +." };
  if (/PHONE_NUMBER_BANNED/.test(message)) return { error: "Telegram has restricted this phone number. Open Telegram to resolve the account restriction before connecting." };
  if (/PHONE_CODE_EXPIRED|LOGIN_EXPIRED/.test(message)) return { error: "This login code expired. Request a new code to continue.", action: "restart" };
  if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(message)) return { error: "That code was not accepted. Enter the latest login code from Telegram." };
  if (/PASSWORD_HASH_INVALID/.test(message)) return { error: "That password was not accepted. Use your Telegram two-step verification password, not your phone passcode." };
  if (/AUTH_RESTART|SESSION_REVOKED/.test(message)) return { error: "Telegram needs a fresh login. Request a new code.", action: "restart" };
  return { error: "Telegram did not finish this request. Check your connection and try again. Your existing chats are safe." };
}
export function validXSession(authToken: unknown, ct0: unknown): boolean {
  return [authToken, ct0].every(value => typeof value === "string" && /^[a-zA-Z0-9_%=-]{20,1024}$/.test(value));
}
export type SetupAccount = { id: string; platform: string; label: string | null; status: string; driver?: string | null };
export type SetupLiveAccount = { accountId: string; state: "ready" | "qr" | "starting" | "disabled" | "disconnected"; qr?: string; detail?: string };
export type SetupConnections = { workerRunning: boolean; platforms: { accounts?: SetupLiveAccount[] } };
export function setupAccountLabel(account: SetupAccount, connections: SetupConnections | null): string {
  if (!connections) return "Checking connection";
  if (!connections.workerRunning) return "Sync is offline";
  const live = connections.platforms.accounts?.find(row => row.accountId === account.id);
  if (live?.state === "ready") return "Connected";
  if (live?.state === "qr") return "Scan QR code";
  if (live?.state === "disconnected") return "Needs attention";
  return "Connecting";
}
