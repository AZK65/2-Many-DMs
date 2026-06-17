import { prisma } from "./store";
import { decrypt } from "../src/lib/crypto";

/* Bridges the env-configured single session into the Account table and routes
   conversations per account, so the worker can fan out to N accounts. The
   "env" account (label "default") draws its session from env vars; additional
   accounts added later store their own encrypted session on the row. */

// Must match the web's getCurrentUser() demo user so the worker and the UI
// share the same accounts.
const OWNER_EMAIL = process.env.OWNER_EMAIL || "you@omni-crm.local";

export interface RunnableAccount {
  id: string;
  platform: string;
  label: string | null;
  driver: string | null;
  session: string | null; // decrypted; null => use env (the default account)
}

async function defaultUserId(): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    create: { email: OWNER_EMAIL, name: "You" },
    update: {},
  });
  return u.id;
}

// Platforms enabled via env, with their selected driver.
function envPlatforms(): { platform: string; driver: string }[] {
  const out: { platform: string; driver: string }[] = [];
  const { TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION } = process.env;
  // TELEGRAM_ENABLED=0 skips Telegram (e.g. when testing locally while a prod
  // worker holds the same session, which would otherwise trip AUTH_KEY_DUPLICATED).
  if (
    process.env.TELEGRAM_ENABLED !== "0" &&
    TELEGRAM_API_ID &&
    TELEGRAM_API_HASH &&
    TELEGRAM_SESSION
  )
    out.push({ platform: "telegram", driver: "mtproto" });
  if (process.env.WHATSAPP_ENABLED === "1")
    out.push({
      platform: "whatsapp",
      driver: process.env.WHATSAPP_DRIVER === "baileys" ? "baileys" : "web",
    });
  if (process.env.X_ENABLED === "1")
    out.push({
      platform: "x",
      driver: process.env.X_DRIVER === "api" ? "api" : "browser",
    });
  return out;
}

// Idempotent: ensure an Account row exists for each env-enabled platform, then
// assign any conversation still missing an accountId to its platform's account.
// Run this BEFORE starting adapters so new messages never create null-account
// duplicates of a not-yet-backfilled chat.
export async function ensureAndBackfill(): Promise<void> {
  const userId = await defaultUserId();
  for (const { platform, driver } of envPlatforms()) {
    const existing = await prisma.account.findFirst({
      where: { userId, platform, label: "default" },
    });
    if (!existing) {
      await prisma.account.create({
        data: { userId, platform, label: "default", status: "connected", driver },
      });
    } else if (existing.driver !== driver || existing.status === "disconnected") {
      await prisma.account.update({
        where: { id: existing.id },
        data: { driver, status: "connected" },
      });
    }
  }

  // Backfill conversations missing an accountId → their platform's account.
  const accounts = await prisma.account.findMany();
  const byPlatform = new Map<string, string>();
  for (const a of accounts) if (!byPlatform.has(a.platform)) byPlatform.set(a.platform, a.id);
  for (const [platform, accountId] of byPlatform) {
    const r = await prisma.conversation.updateMany({
      where: { platform, accountId: null },
      data: { accountId },
    });
    if (r.count) console.log(`[accounts] backfilled ${r.count} ${platform} chats → ${accountId}`);
  }
}

// Accounts the worker should run (anything not explicitly disconnected).
export async function listRunnableAccounts(): Promise<RunnableAccount[]> {
  const accounts = await prisma.account.findMany({
    where: { status: { not: "disconnected" } },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    label: a.label,
    driver: a.driver,
    session: a.session ? safeDecrypt(a.session) : null,
  }));
}

function safeDecrypt(blob: string): string | null {
  try {
    return decrypt(blob);
  } catch {
    return null;
  }
}
