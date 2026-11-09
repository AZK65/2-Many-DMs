import crypto from "node:crypto";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { Logger } from "telegram/extensions";
import { LogLevel } from "telegram/extensions/Logger";
import { telegramSetupError, telegramSetupErrorCode, type SetupError } from "./connection-setup";

type Pending = {
  client: TelegramClient; userId: string; phone: string; phoneCodeHash: string;
  apiId: number; apiHash: string; expiresAt: number; timer: NodeJS.Timeout;
  needsPassword: boolean; busy: boolean; result?: { session: string; phone: string }; retryAt: number;
};
const state = globalThis as typeof globalThis & {
  __tgSetup?: { logins: Map<string, Pending>; cooldown: Map<string, number> };
};
const { logins, cooldown } = state.__tgSetup ||= { logins: new Map(), cooldown: new Map() };
const TTL = 5 * 60_000;

async function disconnect(client: TelegramClient) { await client.disconnect().catch(() => {}); }
export async function cancelLogin(loginId: string, userId: string) {
  const p = logins.get(loginId);
  if (!p || p.userId !== userId) return;
  clearTimeout(p.timer); logins.delete(loginId);
  await disconnect(p.client);
}
async function deadline<T>(client: TelegramClient, task: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void disconnect(client); reject(new Error("LOGIN_TIMEOUT")); }, 30_000);
    })]);
  } finally { clearTimeout(timer); }
}
export async function startLogin(userId: string, phone: string, credentials: { apiId: number; apiHash: string }) {
  const now = Date.now();
  for (const [key, until] of cooldown) if (until <= now) cooldown.delete(key);
  const remaining = Math.ceil(((cooldown.get(userId) || 0) - now) / 1000);
  if (remaining > 0) return { error: "Wait before requesting another Telegram code.", retryAfter: remaining };
  cooldown.set(userId, now + 60_000); // claim before awaiting: prevents duplicate sends
  for (const [id, pending] of logins) if (pending.userId === userId) await cancelLogin(id, userId);
  const client = new TelegramClient(new StringSession(""), credentials.apiId, credentials.apiHash, {
    connectionRetries: 1, requestRetries: 1, floodSleepThreshold: 0,
    baseLogger: new Logger(LogLevel.NONE),
  });
  try {
    const sent = await deadline(client, (async () => {
      await client.connect();
      return client.sendCode(credentials, phone);
    })());
    const loginId = crypto.randomUUID();
    const expiresAt = Date.now() + TTL;
    const timer = setTimeout(() => void cancelLogin(loginId, userId), TTL);
    timer.unref();
    logins.set(loginId, { client, userId, phone, phoneCodeHash: sent.phoneCodeHash,
      ...credentials, expiresAt, timer, busy: false, needsPassword: false, retryAt: 0 });
    return { loginId, expiresAt, retryAfter: 60, delivery: sent.isCodeViaApp ? "app" : "phone" };
  } catch (cause) {
    await disconnect(client);
    const error = telegramSetupError(cause);
    console.warn(`[telegram-login] code request failed (${telegramSetupErrorCode(cause)})`);
    if (error.retryAfter) cooldown.set(userId, Date.now() + error.retryAfter * 1000);
    else cooldown.delete(userId);
    return error;
  }
}
export type VerifyResult = { status: "ok"; session: string; phone: string }
  | { status: "needs_password" } | ({ status: "error" } & SetupError);
export async function verifyLogin(userId: string, loginId: string, code: string, password?: string): Promise<VerifyResult> {
  const p = logins.get(loginId);
  if (!p || p.userId !== userId || p.expiresAt <= Date.now()) return { status: "error", ...telegramSetupError(new Error("LOGIN_EXPIRED")) };
  if (p.result) return { status: "ok", ...p.result }; // database retries do not consume another code
  if (p.busy) return { status: "error", error: "This code is already being checked. Please wait." };
  if (p.retryAt > Date.now()) return { status: "error", error: "Wait before trying again.", retryAfter: Math.ceil((p.retryAt - Date.now()) / 1000) };
  p.busy = true;
  try {
    if (!p.needsPassword) {
      try {
        await deadline(p.client, p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: code })));
      } catch (cause) {
        if ((cause as { errorMessage?: string }).errorMessage?.includes("SESSION_PASSWORD_NEEDED")) p.needsPassword = true;
        else throw cause;
      }
    }
    if (p.needsPassword) {
      if (!password) return { status: "needs_password" };
      await deadline(p.client, (async () => {
        const params = await p.client.invoke(new Api.account.GetPassword());
        await p.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(params, password) }));
      })());
    }
    p.result = { phone: p.phone, session: JSON.stringify({ apiId: p.apiId, apiHash: p.apiHash, session: String(p.client.session.save()) }) };
    await disconnect(p.client); // release before the worker uses this authorization
    return { status: "ok", ...p.result };
  } catch (cause) {
    const error = telegramSetupError(cause);
    if (error.retryAfter) p.retryAt = Date.now() + error.retryAfter * 1000;
    if (error.action === "restart" || (cause as Error).message === "LOGIN_TIMEOUT") {
      await cancelLogin(loginId, userId); error.action = "restart";
    }
    return { status: "error", ...error };
  } finally { p.busy = false; }
}
