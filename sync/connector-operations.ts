/**
 * A deadline bounds the caller's wait, not the underlying transport operation.
 * Keep ownership until that operation actually settles so a watchdog cannot
 * launch another browser or disconnect a send that is still in progress.
 */
export class ConnectorOperations<Key extends object> {
  private lifecycle = new WeakMap<Key, {
    kind: "start" | "recover";
    startedAt: number;
    promise: Promise<void>;
  }>();
  private sends = new WeakMap<Key, number>();

  constructor(private now: () => number = Date.now) {}

  runLifecycle(
    key: Key,
    kind: "start" | "recover",
    operation: () => Promise<void>,
  ): Promise<void> {
    const existing = this.lifecycle.get(key);
    if (existing) return existing.promise;
    if (kind === "recover" && (this.sends.get(key) || 0) > 0) {
      return Promise.reject(new Error("Connector recovery deferred while a send is in progress"));
    }
    const promise = Promise.resolve().then(operation);
    const entry = { kind, startedAt: this.now(), promise };
    this.lifecycle.set(key, entry);
    const release = () => {
      if (this.lifecycle.get(key) === entry) this.lifecycle.delete(key);
    };
    void promise.then(release, release);
    return promise;
  }

  async send<T>(key: Key, operation: () => Promise<T>): Promise<T> {
    // A ready connector may still be completing its initial backfill. Only a
    // recovery owns the transport exclusively; that must finish before sends.
    if (this.lifecycle.get(key)?.kind === "recover") {
      throw new Error("Connector is reconnecting; no message was sent");
    }
    this.sends.set(key, (this.sends.get(key) || 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = (this.sends.get(key) || 1) - 1;
      if (remaining) this.sends.set(key, remaining);
      else this.sends.delete(key);
    }
  }

  canRecover(key: Key): boolean {
    return !this.lifecycle.has(key) && !this.sends.has(key);
  }

  snapshot(key: Key) {
    const lifecycle = this.lifecycle.get(key);
    return {
      operation: lifecycle?.kind || null,
      operationAgeMs: lifecycle ? Math.max(0, this.now() - lifecycle.startedAt) : 0,
      activeSends: this.sends.get(key) || 0,
    };
  }
}
