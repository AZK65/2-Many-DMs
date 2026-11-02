import type { Readable } from "node:stream";
import { getContentType, normalizeMessageContent } from "@whiskeysockets/baileys";
import { MAX_BYTES } from "./media";
import type { InboundMessage } from "./adapters/types";

// Manual downloads must not inherit the smaller background-sync budget.
export const WHATSAPP_RECOVERY_MAX_BYTES = Number(process.env.MEDIA_RECOVERY_MAX_MB || 250) * 1024 * 1024;
type Media = NonNullable<InboundMessage["media"]>;
type RawMessage = any; // Native protobuf envelopes have several wrapper variants.

export function whatsappMediaContent(message: RawMessage) {
  const normalized = normalizeMessageContent(message.message);
  const kind = getContentType(normalized);
  const types: Record<string, Media["type"]> = { imageMessage: "image", videoMessage: "video", audioMessage: "audio", stickerMessage: "sticker", documentMessage: "file" };
  const type = kind && types[kind];
  if (!type) throw new Error("This WhatsApp message does not contain a downloadable attachment.");
  return { content: (normalized as any)[kind!], type };
}

export class WhatsAppMediaLimitError extends Error {
  constructor(maxBytes: number, automatic: boolean) {
    super(automatic
      ? `This attachment exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB automatic download limit. Use Recover to fetch it manually.`
      : `This attachment exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit. Open it in WhatsApp.`);
  }
}

function statusOf(error: any): number | undefined {
  return error?.response?.status ?? error?.output?.statusCode ?? error?.statusCode ?? error?.status;
}

function downloadError(error: any): Error {
  if (error instanceof WhatsAppMediaLimitError) return error;
  const detail = String(error?.message || "");
  if (/larger than the .* attachment limit/i.test(detail)) return new Error(detail);
  if (/ENOSPC|EACCES|EROFS/.test(error?.code || "")) return new Error("This device could not save the attachment. Check free disk space and file permissions, then try again.");
  if (/ETIMEDOUT|ECONNABORTED|ERR_CANCELED|ECONNRESET|ENOTFOUND|EAI_AGAIN/.test(error?.code || "") || /timed? ?out/i.test(detail)) {
    return new Error("The WhatsApp attachment download was interrupted. Check your connection and try again.");
  }
  if ([404, 410].includes(statusOf(error) || 0) || /re-upload failed by device \(NOT_FOUND\)/i.test(detail)) {
    return new Error("WhatsApp could not retrieve this file. Open WhatsApp on your phone and try Recover again. If the file is missing there too, ask the sender to resend it.");
  }
  // Never expose signed media URLs, encryption keys or raw protocol errors.
  return new Error("WhatsApp could not retrieve this attachment. Open WhatsApp on your phone, check the file is available, and try Recover again.");
}

export async function downloadWhatsAppMedia(message: RawMessage, options: {
  automatic: boolean;
  download: (message: RawMessage, signal: AbortSignal) => Promise<Readable>;
  refresh: (message: RawMessage) => Promise<RawMessage>;
  remember: (message: RawMessage) => void;
  save: (stream: Readable, media: ReturnType<typeof whatsappMediaContent>, maxBytes: number) => Promise<string>;
  timeoutMs?: number;
}): Promise<Media> {
  const maxBytes = options.automatic ? MAX_BYTES : WHATSAPP_RECOVERY_MAX_BYTES;
  let current = message;
  const identity = (m: RawMessage) => JSON.stringify([m?.key?.remoteJid, m?.key?.id, m?.key?.fromMe, m?.key?.participant]);
  const expectedIdentity = identity(message);
  const attempt = async (): Promise<Media> => {
    const media = whatsappMediaContent(current);
    const size = Number(media.content.fileLength?.toNumber?.() ?? media.content.fileLength ?? 0);
    if (size > maxBytes) throw new WhatsAppMediaLimitError(maxBytes, options.automatic);
    if (!media.content.mediaKey?.length) throw new Error("WhatsApp attachment metadata is incomplete.");
    const controller = new AbortController();
    let stream: Readable | undefined;
    const timer = setTimeout(() => {
      controller.abort();
      stream?.destroy(Object.assign(new Error("WhatsApp attachment download timed out"), { code: "ETIMEDOUT" }));
    }, options.timeoutMs ?? 120_000);
    try {
      stream = await options.download(current, controller.signal);
      const url = await options.save(stream, media, maxBytes);
      return { type: media.type, url, name: media.content.fileName || undefined, isGif: media.content.gifPlayback === true };
    } finally { clearTimeout(timer); stream?.destroy(); }
  };
  try {
    try { return await attempt(); }
    catch (error) {
      // Own this retry around the entire stream, not only HTTP response setup.
      // Both Axios and wrapped protocol errors can report expired CDN links.
      if (![403, 404, 410].includes(statusOf(error) || 0)) throw error;
      const refreshed = await options.refresh(current);
      if (!refreshed || identity(refreshed) !== expectedIdentity) {
        throw new Error("WhatsApp returned a different message during attachment recovery.");
      }
      current = refreshed;
      options.remember(current); // Keep the renewed link across worker restarts.
      return await attempt();
    }
  } catch (error) { throw downloadError(error); }
}

/** One real recovery per attachment/account, including concurrent UI/retention
 * requests. A manual request may retry after a smaller automatic attempt fails. */
export class WhatsAppMediaRecoveryQueue {
  private pending = new Map<string, { automatic: boolean; promise: Promise<void> }>();
  private tail: Promise<unknown> = Promise.resolve();
  run(key: string, automatic: boolean, work: () => Promise<void>): Promise<void> {
    const active = this.pending.get(key);
    if (active) return !automatic && active.automatic
      ? active.promise.catch(() => this.run(key, false, work)) : active.promise;
    if (this.pending.size >= 16) return Promise.reject(new Error("WhatsApp downloads are busy. Please try again shortly."));
    const promise = this.tail.then(work).finally(() => { this.pending.delete(key); });
    this.pending.set(key, { automatic, promise });
    this.tail = promise.catch(() => {});
    return promise;
  }
}
