import { telegramCredentials } from "./connection-setup";

/** Credentials travel inside the encrypted session. Legacy sessions use env. */
export function resolveTelegramSession(stored: string | null, env: Record<string, string | undefined> = process.env) {
  if (stored?.startsWith("{")) {
    try {
      const data = JSON.parse(stored);
      const credentials = telegramCredentials(data.apiId, data.apiHash);
      return credentials && typeof data.session === "string" && data.session
        ? { ...credentials, session: data.session } : null;
    } catch { return null; }
  }
  const credentials = telegramCredentials(env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH);
  const session = stored || env.TELEGRAM_SESSION;
  return credentials && session ? { ...credentials, session } : null;
}
