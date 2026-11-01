import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./store";

const OCR_MODEL = process.env.OLLAMA_OCR_MODEL || "glm-ocr:latest";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OCR_TIMEOUT_MS = Math.max(30_000, Number(process.env.OLLAMA_OCR_TIMEOUT_MS || 180_000));
// Live OCR is intentionally slow and unloads its model after each image. A
// large historical photo library must be an explicit backfill, never something
// that silently keeps a laptop hot after the feature is installed.
const OCR_INTERVAL_MS = Math.max(15_000, Number(process.env.OCR_INTERVAL_MS || 60_000));
const OCR_RETRY_MS = Math.max(60_000, Number(process.env.OCR_RETRY_MS || 6 * 60 * 60 * 1_000));
const OCR_MAX_BYTES = Math.max(1, Number(process.env.OCR_MAX_MB || 20)) * 1024 * 1024;
const OCR_TEXT_LIMIT = Math.max(1_000, Number(process.env.OCR_TEXT_LIMIT || 30_000));
const OCR_MAX_TOKENS = Math.max(128, Number(process.env.OCR_MAX_TOKENS || 512));
const OCR_KEEP_ALIVE = process.env.OCR_KEEP_ALIVE || "0s";
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

function localMediaPath(mediaUrl: string): string | null {
  const clean = mediaUrl.split(/[?#]/)[0];
  if (!clean.startsWith("/media/")) return null;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  const filename = path.basename(decoded);
  if (!filename || filename === "." || filename === "..") return null;
  return path.join(process.cwd(), "public", "media", filename);
}

async function modelAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  timeout.unref?.();
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (data.models || []).some((item) => {
      const name = item.name || item.model || "";
      return name === OCR_MODEL || name.replace(/:latest$/, "") === OCR_MODEL.replace(/:latest$/, "");
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanOcrText(value: string): string {
  const cleaned = value
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/\u0000/g, "")
    .trim();
  // The Ollama renderer can occasionally repeat the final recognized line
  // until generation stops. Collapse only adjacent duplicates so legitimate
  // repeated labels elsewhere in a screenshot are preserved.
  const lines: string[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const normalized = line.trim();
    if (normalized && normalized === lines[lines.length - 1]) continue;
    lines.push(normalized);
  }
  return lines.join("\n").trim().slice(0, OCR_TEXT_LIMIT);
}

async function recognizeImage(filePath: string): Promise<string> {
  const info = await fs.stat(filePath);
  if (!info.isFile()) throw new Error("The attachment is not a readable image file.");
  if (info.size > OCR_MAX_BYTES) {
    throw new Error(`Image exceeds the ${Math.round(OCR_MAX_BYTES / 1024 / 1024)} MB OCR limit.`);
  }
  const image = await fs.readFile(filePath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OCR_MODEL,
        prompt: "Text Recognition:",
        images: [image.toString("base64")],
        stream: false,
        keep_alive: OCR_KEEP_ALIVE,
        // Search needs readable text rather than a full document re-creation.
        // A bounded output avoids pathological repeated generations and keeps
        // the background indexer light enough to coexist with live sync.
        options: { temperature: 0, num_predict: OCR_MAX_TOKENS },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      response?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error || `GLM-OCR returned ${response.status}.`);
    return cleanOcrText(data.response || "");
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`GLM-OCR did not finish within ${Math.ceil(OCR_TIMEOUT_MS / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
        { ocrModel: { not: OCR_MODEL } },
        { ocrStatus: "processing", ocrUpdatedAt: { lt: retryBefore } },
        { ocrStatus: "failed", ocrUpdatedAt: { lt: retryBefore } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, mediaUrl: true },
  });
}

async function indexCandidate(candidate: OcrCandidate): Promise<"indexed" | "skipped" | "failed"> {
  const filePath = candidate.mediaUrl ? localMediaPath(candidate.mediaUrl) : null;
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

  await prisma.message.updateMany({
    where: { id: candidate.id, deletedAt: null },
    data: {
      ocrStatus: "processing",
      ocrModel: OCR_MODEL,
      ocrError: null,
      ocrUpdatedAt: new Date(),
    },
  });
  try {
    const ocrText = await recognizeImage(filePath);
    await prisma.message.updateMany({
      where: { id: candidate.id, deletedAt: null },
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
      where: { id: candidate.id, deletedAt: null },
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
