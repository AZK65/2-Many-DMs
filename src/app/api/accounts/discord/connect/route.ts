import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { clientIp, getCurrentUser } from "@/lib/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";
// View Channels, Send Messages, Attach Files, Read Message History, and Send
// Messages in Threads. No admin/moderation permission is requested.
const BOT_PERMISSIONS = "274878008320";

type DiscordBotUser = {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
};

function botToken(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^Bot\s+/i, "") : "";
}

async function discordGet<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new Error("Discord rejected that bot token. Reset it in the Developer Portal and try again.");
      throw new Error(`Discord could not verify this bot (${response.status}).`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(clientIp(req));
  const body = await req.json().catch(() => ({}));
  const token = botToken(body.botToken);
  const requestedLabel = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
  if (!token || token.length > 300) {
    return NextResponse.json(
      { error: "Paste the bot token from Discord Developer Portal → Bot." },
      { status: 400 }
    );
  }

  try {
    const bot = await discordGet<DiscordBotUser>("/users/@me", token);
    if (!bot.bot) {
      return NextResponse.json(
        { error: "That is not a Discord bot token. Personal user tokens are not supported." },
        { status: 400 }
      );
    }

    const application = await discordGet<{ id: string }>("/oauth2/applications/@me", token)
      .catch(() => ({ id: bot.id }));
    const label = requestedLabel || `@${bot.username} (bot)`;
    const session = encrypt(token);
    const existing = await prisma.account.findFirst({
      where: { userId: user.id, platform: "discord", driver: "bot", label },
    });
    const account = existing
      ? await prisma.account.update({
          where: { id: existing.id },
          data: {
            session,
            status: "connected",
            detail: `Official bot @${bot.username}`,
            driver: "bot",
          },
        })
      : await prisma.account.create({
          data: {
            userId: user.id,
            platform: "discord",
            label,
            session,
            status: "connected",
            detail: `Official bot @${bot.username}`,
            driver: "bot",
          },
        });

    const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
    const workerReloaded = await fetch(`${controlUrl}/reload`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
      .then((response) => response.ok)
      .catch(() => false);
    const installUrl =
      `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(application.id)}` +
      `&permissions=${BOT_PERMISSIONS}&scope=bot`;

    return NextResponse.json({
      ok: true,
      accountId: account.id,
      label: account.label,
      installUrl,
      workerReloaded,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Discord token verification timed out. Check your connection and try again."
        : error instanceof Error
          ? error.message
          : "Discord could not verify this bot token.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
