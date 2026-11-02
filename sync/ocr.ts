import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./store";
import { OCR_MODEL, PHOTO_LAYOUT_MODELS, localPhotoPath, recognizeLocalPhoto } from "../src/lib/local-ocr";
import { requireLocalModel } from "../src/lib/local-ollama";

// Live OCR is intentionally slow and unloads its model after each image. A
// large historical photo library must be an explicit backfill, never something
// that silently keeps a laptop hot after the feature is installed.
const OCR_INTERVAL_MS = Math.max(15_000, Number(process.env.OCR_INTERVAL_MS || 60_000));
const OCR_RETRY_MS = Math.max(60_000, Number(process.env.OCR_RETRY_MS || 6 * 60 * 60 * 1_000));
const OCR_INCLUDE_HISTORY = process.env.OCR_INCLUDE_HISTORY === "1";
const OCR_STATE_PATH = path.join(process.env.DATA_DIR || process.cwd(), ".ocr_state.json");

type OcrCandidate = {
  id: string;
  mediaUrl: string | null;
};

function enabled(): boolean {
  return process.env.OCR_ENABLED !== "0";
}

async function liveIndexStart(): Promise<Date | null> {
  if (OCR_INCLUDE_HISTORY) return null;

  try {
    const saved = JSON.parse(await fs.readFile(OCR_STATE_PATH, "utf8")) as {
      liveSince?: unknown;
    };
    if (typeof saved.liveSince === "string") {
      const date = new Date(saved.liveSince);
      if (!Number.isNaN(date.getTime())) return date;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      console.warn(`[ocr] could not read ${OCR_STATE_PATH}: ${String(error)}`);
    }
  }

  const liveSince = new Date();
  try {
    await fs.mkdir(path.dirname(OCR_STATE_PATH), { recursive: true });
    const temporaryPath = `${OCR_STATE_PATH}.${process.pid}.tmp`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ liveSince: liveSince.toISOString() }, null, 2)}\n`,
      "utf8"
    );
    await fs.rename(temporaryPath, OCR_STATE_PATH);
  } catch (error) {
    console.warn(`[ocr] could not save live indexing cutoff: ${String(error)}`);
  }
  return liveSince;
}

async function modelAvailable(): Promise<boolean> {
  try { await requireLocalModel(OCR_MODEL); return true; } catch { return false; }
}

async function nextCandidate(liveSince: Date | null): Promise<OcrCandidate | null> {
  const retryBefore = new Date(Date.now() - OCR_RETRY_MS);
  return prisma.message.findFirst({
    where: {
      mediaType: "image",
      deletedAt: null,
      // Platform adapters save recoverable Telegram, WhatsApp, X, and Gmail
      // images here. Remote-only previews are not downloaded by the indexer.
      mediaUrl: { startsWith: "/media/" },
      ...(liveSince ? { createdAt: { gte: liveSince } } : {}),
      OR: [
        { ocrStatus: null },
        { ocrModel: { notIn: [OCR_MODEL, ...PHOTO_LAYOUT_MODELS] } },
        { ocrStatus: "processing", ocrUpdatedAt: { lt: retryBefore } },
        { ocrStatus: "failed", ocrUpdatedAt: { lt: retryBefore } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, mediaUrl: true },
  });
}

async function indexCandidate(candidate: OcrCandidate): Promise<"indexed" | "skipped" | "failed"> {
  let filePath: string | null = null;
  try { filePath = candidate.mediaUrl ? localPhotoPath(candidate.mediaUrl) : null; } catch { /* not local */ }
  if (!filePath) {
    await prisma.message.updateMany({
      where: { id: candidate.id, deletedAt: null },
      data: {
        ocrStatus: "skipped",
        ocrModel: OCR_MODEL,
        ocrError: "OCR only runs on attachments stored locally.",
        ocrUpdatedAt: new Date(),
      },
    });
    return "skipped";
  }

  const claimed = await prisma.message.updateMany({
    where: { id: candidate.id, deletedAt: null, OR: [{ ocrModel: null }, { ocrModel: { notIn: PHOTO_LAYOUT_MODELS } }, { ocrStatus: { not: "complete" } }] },
    data: {
      ocrStatus: "processing",
      ocrModel: OCR_MODEL,
      ocrError: null,
      ocrUpdatedAt: new Date(),
    },
  });
  if (!claimed.count) return "skipped";
  try {
    const ocrText = await recognizeLocalPhoto(candidate.mediaUrl!, { background: true });
    await prisma.message.updateMany({
      where: { id: candidate.id, deletedAt: null, ocrStatus: "processing", ocrModel: OCR_MODEL },
      data: {
        ocrText,
        ocrStatus: "complete",
        ocrModel: OCR_MODEL,
        ocrError: null,
        ocrUpdatedAt: new Date(),
      },
    });
    return "indexed";
  } catch (error) {
    const detail = String(error).replace(/^Error:\s*/, "").slice(0, 500);
    const skipped = /not a readable image|exceeds the .* OCR limit|ENOENT/i.test(detail);
    await prisma.message.updateMany({
      where: { id: candidate.id, deletedAt: null, ocrStatus: "processing", ocrModel: OCR_MODEL },
      data: {
        ocrStatus: skipped ? "skipped" : "failed",
        ocrModel: OCR_MODEL,
        ocrError: detail,
        ocrUpdatedAt: new Date(),
      },
    });
    if (!skipped) console.error(`[ocr] ${candidate.id}: ${detail}`);
    return skipped ? "skipped" : "failed";
  }
}

export function startOcrIndexer(): void {
  if (!enabled()) {
    console.log("[ocr] local image indexing disabled");
    return;
  }

  let running = false;
  let providerReady = false;
  let lastProviderCheck = 0;
  let indexedSinceLog = 0;
  let liveSince: Date | null = null;
  let initialized = false;

  const tick = async () => {
    if (!initialized || running) return;
    running = true;
    try {
      if (!providerReady || Date.now() - lastProviderCheck > 60_000) {
        lastProviderCheck = Date.now();
        providerReady = await modelAvailable();
        if (!providerReady) return;
      }
      const candidate = await nextCandidate(liveSince);
      if (!candidate) return;
      const result = await indexCandidate(candidate);
      if (result === "failed") providerReady = await modelAvailable();
      if (result === "indexed") {
        indexedSinceLog += 1;
        if (indexedSinceLog === 1 || indexedSinceLog % 25 === 0) {
          console.log(`[ocr] indexed ${indexedSinceLog} image${indexedSinceLog === 1 ? "" : "s"} with ${OCR_MODEL}`);
        }
      }
    } catch (error) {
      console.error("[ocr] indexer error:", error);
    } finally {
      running = false;
    }
  };

  void liveIndexStart().then(async (start) => {
    liveSince = start;
    // A worker restart can interrupt one inference after it claimed a row.
    // Requeue it, while the persistent cutoff prevents the historical backlog
    // from being picked up again in normal live mode.
    await prisma.message.updateMany({
      where: { ocrStatus: "processing" },
      data: { ocrStatus: null, ocrUpdatedAt: null },
    });
    console.log(
      OCR_INCLUDE_HISTORY
        ? `[ocr] historical indexing enabled (${OCR_MODEL})`
        : `[ocr] live indexing from ${liveSince?.toISOString()} (${OCR_MODEL})`
    );
    initialized = true;
    await tick();
  }).catch((error) => console.error("[ocr] could not initialize indexer:", error));
  setInterval(() => void tick(), OCR_INTERVAL_MS).unref?.();
}
