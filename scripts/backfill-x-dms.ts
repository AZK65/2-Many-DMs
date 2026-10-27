import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

type QueueItem = {
  id: string;
  externalId: string;
  accountId: string;
  inboxCategory: "general" | "spam";
  isGroup: boolean;
  name: string;
};

type Checkpoint = {
  startedAt: string;
  snapshotBefore: string;
  sinceTimestamp: number;
  skipped: number;
  index: number;
  queue: QueueItem[];
  failures: Array<{ id: string; name: string; error: string }>;
  completedAt?: string;
};

const controlUrl = process.env.SYNC_CONTROL_URL || "http://127.0.0.1:4001";
const dataDir = process.env.DATA_DIR || process.cwd();
const checkpointPath = path.join(dataDir, ".x_backfill_progress.json");
const cooldownPath = path.join(dataDir, ".x_cooldown.json");
// History routes are far more expensive than the live inbox. One request per
// minute keeps a repair run below XChat's observed browser-rate-limit budget.
const paceMs = Math.max(30_000, Number(process.env.X_BACKFILL_PACE_MS || 60_000));

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function save(checkpoint: Checkpoint): void {
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

function readCooldown(): { retryAt: number; failures: number } {
  try {
    const parsed = JSON.parse(fs.readFileSync(cooldownPath, "utf8"));
    return {
      retryAt: Number(parsed.retryAt) || 0,
      failures: Number(parsed.failures) || 0,
    };
  } catch {
    return { retryAt: 0, failures: 0 };
  }
}

async function waitForCooldown(): Promise<void> {
  let cooldown = readCooldown();
  while (cooldown.retryAt > Date.now()) {
    const remainingMs = cooldown.retryAt - Date.now();
    console.log(
      JSON.stringify({ event: "cooldown", remainingMs, failures: cooldown.failures })
    );
    await sleep(Math.min(60_000, remainingMs));
    cooldown = readCooldown();
  }
}

async function buildCheckpoint(): Promise<Checkpoint> {
  const snapshotBefore = new Date(
    argument("snapshot-before") || Date.now()
  );
  if (Number.isNaN(snapshotBefore.getTime())) {
    throw new Error("--snapshot-before must be a valid date");
  }
  const skipped = Math.max(0, Number(argument("skip") || 0));
  const sinceTimestamp = Number(
    argument("since") || Date.now() - 24 * 60 * 60 * 1000
  );
  const [conversations, historicalLastMessages] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        platform: "x",
        externalId: { not: null },
        accountId: { not: null },
      },
      select: {
        id: true,
        externalId: true,
        accountId: true,
        inboxCategory: true,
        contact: { select: { name: true, isGroup: true } },
      },
    }),
    prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        conversation: { platform: "x" },
        createdAt: { lt: snapshotBefore },
      },
      _max: { createdAt: true },
    }),
  ]);
  const historicalOrder = new Map(
    historicalLastMessages.map((row) => [
      row.conversationId,
      row._max.createdAt?.getTime() || 0,
    ])
  );
  const queue = conversations
    .sort(
      (a, b) =>
        (historicalOrder.get(b.id) || 0) - (historicalOrder.get(a.id) || 0) ||
        a.id.localeCompare(b.id)
    )
    .slice(skipped)
    .map((conversation) => ({
      id: conversation.id,
      externalId: conversation.externalId!,
      accountId: conversation.accountId!,
      inboxCategory:
        conversation.inboxCategory === "spam" ? ("spam" as const) : ("general" as const),
      isGroup: conversation.contact.isGroup,
      name: conversation.contact.name,
    }));
  return {
    startedAt: new Date().toISOString(),
    snapshotBefore: snapshotBefore.toISOString(),
    sinceTimestamp,
    skipped,
    index: 0,
    queue,
    failures: [],
  };
}

async function loadCheckpoint(): Promise<Checkpoint> {
  if (fs.existsSync(checkpointPath) && argument("fresh") !== "1") {
    return JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as Checkpoint;
  }
  const checkpoint = await buildCheckpoint();
  save(checkpoint);
  return checkpoint;
}

async function requestHistory(item: QueueItem, sinceTimestamp: number): Promise<void> {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await waitForCooldown();
    try {
      const response = await fetch(`${controlUrl}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "x",
          accountId: item.accountId,
          chatExternalId: item.externalId,
          oldestMessageId: "",
          oldestTimestamp: 0,
          count: 500,
          isGroup: item.isGroup,
          inboxCategory: item.inboxCategory,
          sinceTimestamp,
        }),
        signal: AbortSignal.timeout(125_000),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (response.ok) return;
      const error = result.error || `HTTP ${response.status}`;
      if (/already syncing|reconnecting|timed out|cooling down|being paced/i.test(error)) {
        await sleep(5_000 * attempt);
        continue;
      }
      throw new Error(error);
    } catch (error) {
      if (attempt < 8 && /abort|fetch failed|ECONNRESET/i.test(String(error))) {
        await sleep(5_000 * attempt);
        continue;
      }
      throw error;
    }
  }
  throw new Error("X history request exhausted its retries");
}

async function main(): Promise<void> {
  const checkpoint = await loadCheckpoint();
  if (checkpoint.completedAt) {
    console.log(JSON.stringify({ event: "already-complete", ...checkpoint }));
    return;
  }
  console.log(
    JSON.stringify({
      event: "start",
      remaining: checkpoint.queue.length - checkpoint.index,
      total: checkpoint.queue.length,
      skipped: checkpoint.skipped,
      paceMs,
    })
  );
  for (; checkpoint.index < checkpoint.queue.length; checkpoint.index += 1) {
    const item = checkpoint.queue[checkpoint.index];
    try {
      await requestHistory(item, checkpoint.sinceTimestamp);
    } catch (error) {
      checkpoint.failures.push({
        id: item.id,
        name: item.name,
        error: String(error),
      });
    }
    save(checkpoint);
    const completed = checkpoint.index + 1;
    if (completed % 10 === 0 || completed === checkpoint.queue.length) {
      console.log(
        JSON.stringify({
          event: "progress",
          completed,
          total: checkpoint.queue.length,
          failures: checkpoint.failures.length,
          name: item.name,
        })
      );
    }
    await sleep(paceMs);
  }
  checkpoint.completedAt = new Date().toISOString();
  save(checkpoint);
  console.log(
    JSON.stringify({
      event: "done",
      completed: checkpoint.queue.length,
      failures: checkpoint.failures,
      completedAt: checkpoint.completedAt,
    })
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
