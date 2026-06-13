import crypto from "node:crypto";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { Logger } from "telegram/extensions";
import { LogLevel } from "telegram/extensions/Logger";

// Interactive phone-code login for the SaaS onboarding. We own one api_id/hash
// (server-side) so the user only does phone → code → (2FA). The half-finished
// client lives in memory between the two HTTP calls, keyed by a loginId.
type Pending = {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  timer: NodeJS.Timeout;
};

const store: Map<string, Pending> =
  ((globalThis as Record<string, unknown>).__tgLogins as Map<string, Pending>) ||
  ((globalThis as Record<string, unknown>).__tgLogins = new Map());

const TTL_MS = 5 * 60 * 1000;

function creds() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID / TELEGRAM_API_HASH not configured");
  }
  return { apiId, apiHash };
}

async function cleanup(loginId: string, disconnect = true) {
  const p = store.get(loginId);
  if (!p) return;
  clearTimeout(p.timer);
  store.delete(loginId);
  if (disconnect) {
    try {
      await p.client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function startLogin(phone: string): Promise<string> {
  const { apiId, apiHash } = creds();
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 2,
    baseLogger: new Logger(LogLevel.NONE),
  });
  await client.connect();
  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);

  const loginId = crypto.randomUUID();
  const timer = setTimeout(() => cleanup(loginId), TTL_MS);
  store.set(loginId, { client, phone, phoneCodeHash, timer });
  return loginId;
}

export type VerifyResult =
  | { status: "ok"; session: string; phone: string }
  | { status: "needs_password" }
  | { status: "error"; message: string };

export async function verifyLogin(
  loginId: string,
  code: string,
  password?: string
): Promise<VerifyResult> {
  const p = store.get(loginId);
  if (!p) return { status: "error", message: "Login expired — start again." };
  const { client, phone, phoneCodeHash } = p;

  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code })
    );
  } catch (e: unknown) {
    const msg = (e as { errorMessage?: string })?.errorMessage || String(e);
    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      if (!password) return { status: "needs_password" };
      try {
        const pwd = await client.invoke(new Api.account.GetPassword());
        const check = await computeCheck(pwd, password);
        await client.invoke(new Api.auth.CheckPassword({ password: check }));
      } catch {
        return { status: "error", message: "Wrong 2-step password." };
      }
    } else if (msg.includes("PHONE_CODE_INVALID")) {
      return { status: "error", message: "That code is incorrect." };
    } else if (msg.includes("PHONE_CODE_EXPIRED")) {
      await cleanup(loginId);
      return { status: "error", message: "Code expired — start again." };
    } else {
      return { status: "error", message: msg };
    }
  }

  const session = String(client.session.save());
  await cleanup(loginId);
  return { status: "ok", session, phone };
}
