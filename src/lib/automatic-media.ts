import { isGifMedia } from "./gif-media";

export function canAutoLoadMedia(platform: string, media: {
  mediaType?: string | null; mediaIsGif?: boolean; mediaName?: string | null; mediaUrl?: string | null;
}): boolean {
  return platform === "telegram" && (media.mediaType === "sticker" || isGifMedia(media));
}

/** Shared by visible cards, including multi-view. Queued cards that have left
 * the screen are skipped; an active download is allowed to finish and cache. */
export class VisibleMediaQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<boolean>>();
  private failures = new Map<string, { until: number; error: unknown }>();
  constructor(private now = Date.now, private pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  run(key: string, wanted: () => boolean, load: () => Promise<void>): Promise<boolean> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const failure = this.failures.get(key);
    if (failure && failure.until > this.now()) return Promise.reject(failure.error);
    for (const [id, item] of this.failures) if (item.until <= this.now()) this.failures.delete(id);
    const task = this.tail.then(async () => {
      if (!wanted()) return false;
      try { await load(); return true; }
      catch (error) {
        this.failures.set(key, { until: this.now() + 5 * 60_000, error });
        throw error;
      } finally { await this.pause(750); }
    });
    this.pending.set(key, task);
    this.tail = task.catch(() => {}).finally(() => this.pending.delete(key));
    return task;
  }
}

export const visibleMediaQueue = new VisibleMediaQueue();
