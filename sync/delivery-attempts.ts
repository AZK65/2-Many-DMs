/** Deduplicate transport requests within one persisted attempt. An explicit
 * retry increments sendAttempts; it must not inherit a settled failure. */
export class DeliveryAttempts<T> {
  private entries = new Map<string, { attempt: number; settled: boolean; promise: Promise<T> }>();

  run(id: string | undefined, attempt: number, start: () => Promise<T>): Promise<T> {
    if (!id) return start();
    const existing = this.entries.get(id);
    // Never overlap sends for one message, including an incorrectly advanced
    // attempt number. Late requests for an older attempt cannot send it again.
    if (existing && (!existing.settled || attempt <= existing.attempt)) return existing.promise;
    const entry = { attempt, settled: false, promise: Promise.resolve().then(start) };
    this.entries.set(id, entry);
    const finish = () => {
      entry.settled = true;
      setTimeout(() => {
        if (this.entries.get(id) === entry) this.entries.delete(id);
      }, 5 * 60_000).unref?.();
    };
    void entry.promise.then(finish, finish);
    return entry.promise;
  }
}
