import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { InboundMessage } from "./adapters/types";

// Small encrypted, atomic records. No schema migration or second message DB:
// the inbox is authoritative; these files retain interrupted work across boots.
export class DurableRecords<T> {
  private encryptionKey?: Buffer;
  constructor(readonly directory: string) {}
  private key(): Buffer {
    if (this.encryptionKey) return this.encryptionKey;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const keyFile = path.join(this.directory, ".key");
    if (!fs.existsSync(keyFile)) {
      try { fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    this.encryptionKey = fs.readFileSync(keyFile);
    if (this.encryptionKey.length !== 32) throw Error("Invalid retention encryption key");
    return this.encryptionKey;
  }
  private encode(value: T) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), bytes].map(b => b.toString("base64")).join(".");
  }
  private decode(value: string): T {
    const [iv, tag, bytes] = value.split(".").map(s => Buffer.from(s, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8"));
  }
  private file(key: string) {
    return path.join(this.directory, createHash("sha256").update(key).digest("hex") + ".enc");
  }
  put(key: string, value: T) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(key);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, this.encode(value), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  get(key: string): T | undefined {
    const file = this.file(key);
    if (!fs.existsSync(file)) return undefined;
    return this.decode(fs.readFileSync(file, "utf8"));
  }
  remove(key: string) { fs.rmSync(this.file(key), { force: true }); }
  *values(): Generator<T> {
    if (!fs.existsSync(this.directory)) return;
    for (const file of fs.readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.enc$/.test(file)) continue;
      yield this.decode(fs.readFileSync(path.join(this.directory, file), "utf8"));
    }
  }
}

export function canonicalWhatsAppMessage(m: InboundMessage): InboundMessage {
  if (m.platform !== "whatsapp") return m;
  const normalize = (s: string) => s.replace(/@s\.whatsapp\.net(?=:|$)/g, "@c.us");
  return { ...m, chatExternalId: normalize(m.chatExternalId), messageExternalId: normalize(m.messageExternalId),
    contact: { ...m.contact, externalKey: normalize(m.contact.externalKey) },
    ...(m.sender ? { sender: { ...m.sender, externalKey: normalize(m.sender.externalKey) } } : {}),
    ...(m.replyToExternalKey ? { replyToExternalKey: normalize(m.replyToExternalKey) } : {}),
  };
}

export type MediaJob = {
  key: string; accountId: string; chatId: string; messageId: string;
  timestamp: number; attempts: number; nextAt: number;
};

export class MessageRetention {
  readonly incoming: DurableRecords<InboundMessage>;
  readonly media: DurableRecords<MediaJob>;
  private busy = new Set<string>();
  private jobs = new Map<string, MediaJob>();
  private completed = new Set<string>();
  private saving = new Map<string, number>();
  private revisions = new Map<string, symbol>();
  private replaying = false;
  private nextAccountAt = new Map<string, number>();
  constructor(directory: string, private now: () => number = Date.now) {
    this.incoming = new DurableRecords(path.join(directory, "incoming"));
    this.media = new DurableRecords(path.join(directory, "media"));
    for (const job of this.media.values()) this.jobs.set(job.key, job);
  }
  key(accountId: string, messageId: string) { return `${accountId}:${messageId}`; }
  enqueueMedia(m: InboundMessage) {
    if (!m.accountId || !m.media || m.media.url?.startsWith("/media/")) return;
    const key = this.key(m.accountId, m.messageExternalId);
    if (this.jobs.has(key) || this.completed.has(key)) return; // Repeated history must not reset retry backoff.
    const job = { key, accountId: m.accountId, chatId: m.chatExternalId, messageId: m.messageExternalId,
      timestamp: new Date(m.timestamp).getTime(), attempts: 0, nextAt: this.now() };
    this.media.put(key, job);
    this.jobs.set(key, job);
  }
  async save(m: InboundMessage, persist: (m: InboundMessage) => Promise<string | null>) {
    if (!m.accountId) throw Error("Retention requires an account");
    const key = this.key(m.accountId, m.messageExternalId);
    this.incoming.put(key, m);
    const revision = Symbol();
    this.revisions.set(key, revision);
    this.saving.set(key, (this.saving.get(key) || 0) + 1);
    try {
      const result = await persist(m);
      this.enqueueMedia(m);
      // An older write must not erase a newer attachment update still in flight.
      if (this.revisions.get(key) === revision) this.incoming.remove(key);
      return result;
    } finally {
      const remaining = (this.saving.get(key) || 1) - 1;
      if (remaining) this.saving.set(key, remaining);
      else { this.saving.delete(key); this.revisions.delete(key); }
    }
  }
  async replay(accounts: Set<string>, persist: (m: InboundMessage) => Promise<string | null>) {
    if (this.replaying) return;
    this.replaying = true;
    try {
      for (const m of this.incoming.values()) {
        if (!m.accountId || !accounts.has(m.accountId)) continue;
        if (this.saving.has(this.key(m.accountId, m.messageExternalId))) continue;
        await this.save({ ...m, timestamp: new Date(m.timestamp), historical: true }, persist);
      }
    } finally { this.replaying = false; }
  }
  async runOne(accountId: string, recover: (job: MediaJob) => Promise<boolean>, paceMs = 15_000) {
    if (this.busy.has(accountId) || (this.nextAccountAt.get(accountId) || 0) > this.now()) return;
    const job = [...this.jobs.values()].filter(j => j.accountId === accountId && j.nextAt <= this.now())
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!job) return;
    this.busy.add(accountId);
    try {
      if (await recover(job)) { this.media.remove(job.key); this.jobs.delete(job.key); this.completed.add(job.key); return; }
    } catch (error) {
      console.warn(`[retention] attachment deferred account=${accountId}: ${String(error).slice(0, 220)}`);
    } finally {
      this.busy.delete(accountId);
      this.nextAccountAt.set(accountId, this.now() + paceMs);
    }
    job.attempts++;
    job.nextAt = this.now() + Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(job.attempts, 11));
    this.media.put(job.key, job);
  }
}
