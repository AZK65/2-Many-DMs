import fs from "node:fs";
import path from "node:path";
import type { AvatarRefreshResult } from "./adapters/types";
import { avatarErrorCode } from "./avatar-errors";

export type AvatarJob = {
  accountId: string; contactId: string; externalKey: string | null;
  chatId: string; isGroup: boolean; platform: string; attempts: number;
  groupExternalId?: string; senderMessageExternalId?: string;
};
type Counts = { downloaded: number; cached: number; unavailable: number; failed: number; skipped: number };
type State = { startedAt: number; total: number; jobs: AvatarJob[]; counts: Counts; retryAt: Record<string, number>; errors?: Record<string, string> };

export function avatarRetryDelay(error: unknown): number {
  const value = error as { seconds?: number; output?: { statusCode?: number } };
  const seconds = Number(value?.seconds || /FLOOD(?:_PREMIUM)?_WAIT_?(\d+)/i.exec(String(error))?.[1]);
  if (seconds > 0) return Math.max(60_000, (seconds + 5) * 1000);
  if (avatarErrorCode(error) === 429 || /rate.?limit|too many|flood|429/i.test(String(error))) return 60 * 60_000;
  return 60_000;
}

/** One persistent, resumable photo pass. No recurring scans or message work. */
export class AvatarBackfill {
  private state: State = { startedAt: 0, total: 0, jobs: [], counts: { downloaded: 0, cached: 0, unavailable: 0, failed: 0, skipped: 0 }, retryAt: {} };
  private busy = new Set<string>();
  constructor(private file: string) {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(saved.jobs) || !saved.counts) throw new Error("Invalid saved avatar backfill");
      this.state = saved;
    }
  }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
  start(jobs: AvatarJob[], restart = false) {
    if (this.busy.size) {
      if (restart) throw new Error("Avatar requests are active; retry the fresh pass after they finish.");
      return this.snapshot();
    }
    if (this.state.jobs.length && !restart) return this.snapshot();
    const seen = new Set<string>();
    this.state = { startedAt: Date.now(), total: 0, jobs: jobs.filter(job => {
      const key = `${job.accountId}:${job.contactId}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }), counts: { downloaded: 0, cached: 0, unavailable: 0, failed: 0, skipped: 0 }, retryAt: this.state.retryAt };
    this.state.total = this.state.jobs.length;
    this.save();
    return this.snapshot();
  }
  snapshot() {
    const remaining: Record<string, number> = {};
    for (const job of this.state.jobs) remaining[job.platform] = (remaining[job.platform] || 0) + 1;
    return { startedAt: this.state.startedAt, total: this.state.total, pending: this.state.jobs.length,
      ...this.state.counts, remaining, retryAt: this.state.retryAt, errors: this.state.errors || {}, active: [...this.busy] };
  }
  async runOne(accountId: string, process: (job: AvatarJob) => Promise<AvatarRefreshResult | "skipped">, now = Date.now()) {
    if (this.busy.has(accountId) || (this.state.retryAt[accountId] || 0) > now) return;
    const job = this.state.jobs.find(item => item.accountId === accountId);
    if (!job) return;
    this.busy.add(accountId);
    try {
      const result = await process(job);
      this.state.counts[result === "skipped" ? "skipped" : result.source]++;
      this.state.jobs = this.state.jobs.filter(item => item !== job);
      this.state.retryAt[accountId] = Date.now() + 4000;
      if (this.state.errors) delete this.state.errors[accountId];
    } catch (error) {
      // Rate-limit waits apply to the account, not merely the failed photo.
      const delay = avatarRetryDelay(error);
      this.state.errors ||= {};
      this.state.errors[accountId] = String(error).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 200);
      this.state.retryAt[accountId] = Date.now() + delay;
      job.attempts++;
      if (job.attempts >= 3) {
        this.state.jobs = this.state.jobs.filter(item => item !== job);
        this.state.counts.failed++;
      } else if (delay === 60_000) {
        this.state.jobs = [...this.state.jobs.filter(item => item !== job), job];
      }
      console.warn(`[avatars] ${job.platform} photo deferred; retry in ${Math.ceil(delay / 1000)}s`);
    } finally {
      this.busy.delete(accountId);
      this.save();
    }
  }
}
