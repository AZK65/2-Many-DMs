/** One Telegram attachment recovery at a time, shared by visible requests and
 * background retention. Observer timeouts must never release this real lock. */
export class MediaRecoveryQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<void>>();
  private failures = new Map<string, { until: number; error: unknown }>();
  private blockedUntil = 0;
  constructor(private now = Date.now, private pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  run(key: string, automatic: boolean, recover: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 16) return Promise.reject(new Error("Media downloads are busy. Please try again shortly."));
    const task = this.tail.then(async () => {
      if (this.now() < this.blockedUntil) throw new Error("Telegram asked us to pause downloads. Please try again later.");
      const failure = this.failures.get(key);
      if (automatic && failure && failure.until > this.now()) throw failure.error;
      for (const [id, item] of this.failures) if (item.until <= this.now()) this.failures.delete(id);
      try { await recover(); this.failures.delete(key); }
      catch (error) {
        const seconds = Number((error as { seconds?: number })?.seconds || /FLOOD(?:_PREMIUM)?_WAIT[_ ](\d+)/i.exec(String(error))?.[1] || 0);
        if (seconds > 0) this.blockedUntil = this.now() + seconds * 1000;
        this.failures.set(key, { until: this.now() + Math.max(300_000, seconds * 1000), error });
        throw error;
      } finally { await this.pause(1500); }
    });
    this.pending.set(key, task);
    this.tail = task.catch(() => {}).finally(() => this.pending.delete(key));
    return task;
  }
}
