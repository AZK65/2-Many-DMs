import fs from "node:fs";
import path from "node:path";

type Checkpoint = { highId: number; checkedAt: number; retryAt?: number; pending?: { targetId: number; lowerId: number; offsetId: number; since: number } };
type Dialog = { id: string; latestId: number; entity: unknown };
type Message = { id: number; date: number };
type Options = {
  file: string;
  list: () => Promise<Dialog[]>;
  fetch: (entity: unknown, options: { limit: number; offsetId: number; minId: number; maxId: number }) => Promise<Message[]>;
  save: (entity: unknown, message: Message) => Promise<void>;
  ready: () => boolean;
  beforePage: () => Promise<void>;
  now?: () => number;
  pause?: () => Promise<void>;
  maxPages?: number;
};

// A checkpoint describes a COMPLETED range, not simply the newest message we
// happened to see live. Interrupted pages are replayed safely by native ID.
export class TelegramHistorySync {
  private state: { version: number; cursor: number; retryAt: number; chats: Record<string, Checkpoint> } = { version: 1, cursor: 0, retryAt: 0, chats: {} };
  private running?: Promise<void>;
  private stopped = false;
  private lastCheckedAt = 0;
  private observedDialogs: Dialog[] = [];
  constructor(private options: Options) {
    try {
      const saved = JSON.parse(fs.readFileSync(options.file, "utf8"));
      if (saved.version === 1 && saved.chats && typeof saved.cursor === "number") this.state = saved;
    } catch { /* First run: establish a recent baseline, then retain it. */ }
  }
  stop() { this.stopped = true; }
  getStatus(): import("../src/lib/sync-health").SyncHealth {
    const now = (this.options.now || Date.now)();
    const chats = Object.entries(this.state.chats).filter(([, c]) => c.pending).map(([id, c]) => ({
      externalId: id.replace(/^(User|Chat|Channel):/, ""),
      state: (c.retryAt || 0) > now ? "blocked" as const : "queued" as const,
      retryAt: c.retryAt,
    }));
    for (const dialog of this.observedDialogs) {
      const checkpoint = this.state.chats[dialog.id];
      if (dialog.latestId && !checkpoint?.pending && dialog.latestId > (checkpoint?.highId || 0)) chats.push({
        externalId: dialog.id.replace(/^(User|Chat|Channel):/, ""), state: "queued", retryAt: undefined,
      });
    }
    return { lastCheckedAt: this.lastCheckedAt || undefined, pendingChats: chats.filter(c => c.state === "queued").length,
      blockedChats: chats.filter(c => c.state === "blocked").length, retryAt: this.state.retryAt, chats };
  }
  run(): Promise<void> {
    if (!this.running) this.running = this.runOnce().finally(() => { this.running = undefined; });
    return this.running;
  }
  private persist() {
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    fs.writeFileSync(`${this.options.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(`${this.options.file}.tmp`, this.options.file);
  }
  private async runOnce() {
    const now = this.options.now || Date.now;
    const ready = () => !this.stopped && this.options.ready();
    if (!ready() || now() < this.state.retryAt) return;
    let pages = 0;
    let saved = 0;
    try {
      const dialogs = await this.options.list();
      this.observedDialogs = dialogs;
      this.lastCheckedAt = now();
      const start = this.state.cursor % Math.max(1, dialogs.length);
      const ring = dialogs.map((_, n) => (start + n) % dialogs.length);
      // Give unfinished gaps and newly changed known chats half the budget,
      // while the other half keeps discovering/auditing the rest. A huge group
      // must neither wait for a full inbox rotation nor starve older DMs.
      const urgent = ring.filter(index => {
        const d = dialogs[index];
        const c = this.state.chats[d.id];
        return c && (c.pending || d.latestId > c.highId) && (c.retryAt || 0) <= now();
      }).slice(0, Math.max(1, Math.floor((this.options.maxPages || 20) / 2)));
      const priority = new Set(urgent);
      const order = [...urgent, ...ring.filter(index => !priority.has(index))];
      for (const index of order) {
        if (pages >= (this.options.maxPages || 20)) break;
        if (!ready()) return;
        const dialog = dialogs[index];
        this.state.cursor = (index + 1) % dialogs.length;
        if (!dialog.latestId) continue;
        const key = dialog.id;
        const checkpoint = this.state.chats[key] ||= { highId: 0, checkedAt: 0 };
        if ((checkpoint.retryAt || 0) > now()) continue;
        if (!checkpoint.pending && dialog.latestId <= checkpoint.highId && now() - checkpoint.checkedAt < 24 * 60 * 60_000) continue;
        if (!checkpoint.pending) checkpoint.pending = {
          targetId: dialog.latestId,
          // Recheck the recent range daily even if no live update changed the
          // last ID. Never move a gap boundary forward when new messages arrive.
          lowerId: dialog.latestId > checkpoint.highId ? checkpoint.highId : 0,
          offsetId: 0,
          since: checkpoint.highId && dialog.latestId > checkpoint.highId ? 0 : now() - 72 * 60 * 60_000,
        };
        const range = checkpoint.pending;
        await this.options.beforePage();
        if (!ready()) return;
        pages++;
        try {
          // GramJS takes max(offsetId, maxId) for descending history. Keeping
          // maxId at the original target resets every page to page one.
          const upperId = range.offsetId || range.targetId + 1;
          const messages = await this.options.fetch(dialog.entity, { limit: 100, offsetId: upperId, minId: range.lowerId, maxId: upperId });
          if (!ready()) return;
          const relevant = messages.filter((m, index) => m.id > range.lowerId && m.id <= range.targetId && (!range.since || m.date * 1000 >= range.since || (!checkpoint.highId && !range.offsetId && index < 20)));
          for (const message of [...relevant].reverse()) {
            if (!ready()) return;
            await this.options.save(dialog.entity, message);
            saved++;
          }
          const oldest = Math.min(...messages.map(m => m.id));
          const complete = messages.length < 100 || messages.some(m => m.id <= range.lowerId || (range.since && m.date * 1000 < range.since));
          if (complete) {
            checkpoint.highId = Math.max(checkpoint.highId, range.targetId);
            checkpoint.checkedAt = now();
            delete checkpoint.pending;
          } else {
            if (!Number.isFinite(oldest) || (range.offsetId && oldest >= range.offsetId)) throw new Error("Telegram history cursor did not advance");
            range.offsetId = oldest;
          }
          delete checkpoint.retryAt;
          this.persist();
        } catch (error) {
          if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT/i.test(String(error))) throw error;
          checkpoint.retryAt = now() + 15 * 60_000;
          this.persist();
          console.warn(`[telegram] history checkpoint deferred for ${key}:`, String(error));
        }
        await (this.options.pause?.() || new Promise(resolve => setTimeout(resolve, 1000)));
      }
      this.persist();
      if (pages) console.log(`[telegram] automatic history saved=${saved} pages=${pages} incomplete=${Object.values(this.state.chats).filter(c => c.pending).length}`);
    } catch (error) {
      const seconds = Number((error as { seconds?: number })?.seconds) || Number(String(error).match(/(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT)[_ ](\d+)/i)?.[1]);
      this.state.retryAt = now() + Math.max(60, seconds || 300) * 1000;
      this.persist();
      console.warn("[telegram] automatic history paused until", new Date(this.state.retryAt).toISOString(), String(error));
    }
  }
}
