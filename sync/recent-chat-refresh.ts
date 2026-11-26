type Target = { id: string; inboxCategory?: "general" | "spam" };

/** One lightweight foreground read. Rapid chat switches replace queued work;
 * they never create a second full-history backlog or concurrent navigations. */
export class RecentChatRefresh {
  private target?: Target;
  private active?: Target;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private lastStartedAt = -Infinity;
  private checked = new Map<string, number>();
  constructor(private options: {
    refresh: (target: Target) => Promise<void>;
    ready: () => boolean;
    busy: () => boolean;
    retryAt: () => number;
    intervalMs: number;
    onError: (error: unknown) => void;
    now?: () => number;
  }) {}
  get pending() { return Boolean(this.target || this.active); }
  request(id: string, inboxCategory?: "general" | "spam") {
    if (this.stopped || !id) return;
    if (this.target?.id === id) return;
    this.target = undefined; // A cached selection still supersedes an older queued tab.
    if (this.active?.id === id) return;
    const checkedAt = this.checked.get(id);
    if (checkedAt !== undefined && this.now() - checkedAt < 15_000) return;
    this.target = { id, inboxCategory };
    this.schedule(0);
  }
  stop() { this.stopped = true; this.target = undefined; clearTimeout(this.timer); }
  private now() { return (this.options.now || Date.now)(); }
  private schedule(delay: number) {
    if (this.stopped || this.timer || this.active || !this.target) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, delay);
    this.timer.unref?.();
  }
  private async run() {
    if (this.stopped || !this.target || this.active) return;
    const wait = Math.max(this.options.retryAt() - this.now(), this.lastStartedAt + this.options.intervalMs - this.now(),
      !this.options.ready() ? 5000 : this.options.busy() ? 250 : 0);
    if (wait > 0) { this.schedule(wait); return; }
    const target = this.target;
    this.target = undefined; this.active = target; this.lastStartedAt = this.now();
    try {
      await this.options.refresh(target);
      this.checked.set(target.id, this.now());
      if (this.checked.size > 100) this.checked.delete(this.checked.keys().next().value!);
    } catch (error) { this.options.onError(error); }
    finally { this.active = undefined; this.schedule(0); }
  }
}
