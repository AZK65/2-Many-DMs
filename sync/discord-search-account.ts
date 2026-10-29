import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { decryptDiscordSearchSession, encryptDiscordSearchSession } from "./discord-search-secrets";
import { DISCORD_SEARCH_DRIVER, type DiscordPerson } from "./discord-search-core";

// The login window is owned by Omni. Do not read another browser's profile,
// Discord's application storage, clipboard, or OS credential vault.
export async function activateDiscordSearch(token: string) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: token }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Discord did not accept this login. Please sign in again.");
  const person = await response.json() as DiscordPerson;
  if (person.bot || !/^\d+$/.test(person.id) || !person.username) throw new Error("Use your personal Discord account for read-only search.");
  const prisma = new PrismaClient();
  try {
    const owner = await prisma.user.upsert({ where: { email: process.env.OWNER_EMAIL || "you@omni-crm.local" }, create: { email: process.env.OWNER_EMAIL || "you@omni-crm.local", name: "You" }, update: {} });
    // Optional exact-ID migration mapping created from the OLD Omni account.
    // Names alone must never merge two people's private archives.
    let legacy: { accountId?: string; userId?: string } = {};
    try { legacy = JSON.parse(await fs.readFile(path.join(process.env.DATA_DIR || process.cwd(), ".local", "discord-legacy-account.json"), "utf8")); } catch { /* no legacy archive */ }
    const label = `@${person.username} (read-only)`;
    const candidates = await prisma.account.findMany({ where: { userId: owner.id, platform: "discord", driver: DISCORD_SEARCH_DRIVER } });
    const existing = candidates.find(candidate => {
      try { return candidate.session && JSON.parse(decryptDiscordSearchSession(candidate.session)).userId === person.id; } catch { return false; }
    });
    const archive = !existing && legacy.userId === person.id && legacy.accountId
      ? await prisma.account.findFirst({ where: { id: legacy.accountId, userId: owner.id, platform: "discord", driver: { in: ["archive", DISCORD_SEARCH_DRIVER] } } }) : null;
    const data = { label, driver: DISCORD_SEARCH_DRIVER, status: "connected", detail: "Read-only Discord search · starting live connection and history checks",
      session: encryptDiscordSearchSession(JSON.stringify({ token, userId: person.id, username: person.username })) };
    const account = existing || archive
      ? await prisma.account.update({ where: { id: (existing || archive)!.id }, data })
      : await prisma.account.create({ data: { userId: owner.id, platform: "discord", ...data } });
    await fetch(`${process.env.SYNC_CONTROL_URL || "http://127.0.0.1:4001"}/reload`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    return { accountId: account.id, username: person.username };
  } finally { await prisma.$disconnect(); }
}
