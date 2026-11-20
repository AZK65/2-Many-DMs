/** Tracks transport progress without retaining message bodies or exposing IDs.
 * An idle inbox is healthy. Only an actual received message which fails to
 * reach Baileys' upsert handler can trigger recovery. Outgoing echoes cannot
 * hide an older stuck incoming message. */
export class WhatsAppReceiveHealth {
  private pending = new Map<string, number>();
  private completed = new Map<string, number>();
  private failed = new Set<string>();
  private wireCount = 0;
  private upsertCount = 0;
  private inboundCount = 0;
  private unsupportedCount = 0;
  private decryptFailureCount = 0;
  private lastWireAt?: number;
  private lastUpsertAt?: number;
  private lastInboundAt?: number;
  constructor(private now: () => number = Date.now, private stallMs = 90_000) {}

  receive(node: { attrs?: { id?: string }; content?: unknown }) {
    const id = node.attrs?.id;
    if (!id || !Array.isArray(node.content)) return;
    const encrypted = node.content.filter(item => item?.tag === "enc");
    if (!encrypted.length) return;
    this.wireCount++; this.lastWireAt = this.now();
    // Baileys intentionally ignores msmsg; do not reconnect indefinitely over
    // a format which cannot be repaired by opening a different socket.
    if (encrypted.some(item => item.attrs?.type === "msmsg")) { this.unsupportedCount++; return; }
    if (!encrypted.some(item => ["msg", "pkmsg", "skmsg"].includes(item.attrs?.type))) return;
    this.prune();
    // Keep the oldest deadline even during a flood; dropping it would conceal
    // a blocked queue behind newly received frames.
    if (this.pending.size < 2000 && !this.pending.has(id) && !this.completed.has(id)) this.pending.set(id, this.now());
  }

  decryptionFailed(id: string) {
    // Baileys handles retries itself. Some rejected/duplicate ciphertext is
    // acknowledged without an upsert, so it must not cause a reconnect loop.
    this.pending.delete(id);
    this.completed.set(id, this.now());
    if (!this.failed.has(id)) this.decryptFailureCount++;
    this.failed.add(id);
    this.prune();
  }

  upsert(message: { key?: { id?: string | null; fromMe?: boolean | null } | null; message?: unknown; messageStubType?: number | null }, ciphertextStub: number) {
    const id = message.key?.id;
    if (!id) return;
    this.pending.delete(id);
    this.completed.set(id, this.now());
    this.upsertCount++; this.lastUpsertAt = this.now();
    if (message.messageStubType === ciphertextStub) this.decryptionFailed(id);
    else if (message.message) {
      this.failed.delete(id);
      if (!message.key?.fromMe) { this.inboundCount++; this.lastInboundAt = this.now(); }
    }
    this.prune();
  }

  private prune() {
    for (const [id, at] of this.completed) if (this.now() - at > 10 * 60_000) { this.completed.delete(id); this.failed.delete(id); }
    while (this.completed.size > 2000) {
      const id = this.completed.keys().next().value!;
      this.completed.delete(id); this.failed.delete(id);
    }
  }

  snapshot() {
    const oldest = Math.min(...this.pending.values());
    const oldestPendingAgeMs = this.pending.size ? Math.max(0, this.now() - oldest) : 0;
    return { wireCount: this.wireCount, upsertCount: this.upsertCount, inboundCount: this.inboundCount,
      unsupportedCount: this.unsupportedCount, decryptFailureCount: this.decryptFailureCount,
      recentUnresolvedDecryptions: this.failed.size,
      pendingCount: this.pending.size, oldestPendingAgeMs, stalled: oldestPendingAgeMs >= this.stallMs,
      lastWireAt: this.lastWireAt, lastUpsertAt: this.lastUpsertAt, lastInboundAt: this.lastInboundAt };
  }
}

/** Observe only the message ID from Baileys' known decryption error event.
 * Never serialize crypto errors: they may include session keys or payloads. */
export function createWhatsAppReceiveLogger(onDecryptionFailure: (id: string) => void) {
  const logger = {
    level: "silent", trace() {}, debug() {}, info() {}, warn() {}, fatal() {},
    error(data: unknown, message?: string) {
      if (message !== "failed to decrypt message" || !data || typeof data !== "object") return;
      const id = (data as { key?: { id?: unknown } }).key?.id;
      if (typeof id === "string" && id) onDecryptionFailure(id);
    },
    child() { return logger; },
  };
  return logger;
}
