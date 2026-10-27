import type { PrismaClient } from "@prisma/client";

const SQLITE_BUSY_TIMEOUT_MS = 15_000;
const SQLITE_SETUP_ATTEMPTS = 4;

function isSqliteDatabase(): boolean {
  return (process.env.DATABASE_URL || "file:./dev.db").startsWith("file:");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WAL lets readers continue while the sync worker writes. The busy timeout
 * gives short write bursts time to finish instead of immediately surfacing a
 * Prisma timeout. journal_mode persists on the database; busy_timeout applies
 * to the Prisma connection initialized here.
 */
export async function configureSqlite(prisma: PrismaClient): Promise<void> {
  if (!isSqliteDatabase()) return;

  let lastError: unknown;
  for (let attempt = 1; attempt <= SQLITE_SETUP_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
      await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON");
      // Existing installations may have tens of thousands of messages from
      // before these indexes were added to the Prisma schema. Create them at
      // startup as well so chat reads never fall back to a full table scan.
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt")'
      );
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt")'
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < SQLITE_SETUP_ATTEMPTS) await delay(attempt * 250);
    }
  }

  console.error("Could not configure SQLite concurrency settings", lastError);
}
