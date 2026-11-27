import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

export class MautrixError extends Error {
  constructor(readonly code: string, readonly stage: string, readonly uncertain = false) {
    super(`${uncertain ? "waiting for X acceptance failed: " : ""}${stage}: ${code.replaceAll("_", " ")}`);
  }
}
export interface MautrixRPC {
  request<T>(method: string, values?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  stop(): Promise<void>;
}
export type MautrixEvent = { event: string; eventId?: string; [key: string]: any };

/** No listening port and no credentials in command arguments or diagnostics. */
export class MautrixProcess implements MautrixRPC {
  private child?: ChildProcessWithoutNullStreams;
  private next = 0;
  private stopping = false;
  private stopPromise?: Promise<void>;
  private pending = new Map<string, { method: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private onEvent: (event: MautrixEvent) => Promise<void>, private onExit: () => void,
    private binary = process.env.X_MAUTRIX_BINARY || path.join(process.cwd(), ".local/bin", process.platform === "win32" ? "x-mautrix-bridge.exe" : "x-mautrix-bridge")) {}
  private start() {
    if (this.child) return;
    if (this.stopping) throw new MautrixError("stopped", "start");
    const child = spawn(this.binary, [], { stdio: "pipe", env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      let data: any;
      try { data = JSON.parse(line); } catch { void this.stop(); return; }
      if (data.event) {
        void this.onEvent(data).then(() => this.ack(data.eventId, true), () => this.ack(data.eventId, false));
        return;
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new MautrixError(data.error.code, data.error.stage, data.error.uncertain === true));
      else pending.resolve(data.result);
    });
    child.stderr.resume(); // Never copy upstream diagnostics/secrets into the CRM log.
    let ended = false;
    const end = () => {
      if (ended) return; ended = true; lines.close();
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer); entry.reject(new MautrixError("connection_closed", entry.method, entry.method === "send"));
      }
      this.pending.clear();
      if (!this.stopping) this.onExit();
    };
    child.on("error", end); child.on("exit", end);
    child.stdin.on("error", end);
  }
  private ack(id: string | undefined, ok: boolean) {
    if (id && this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ method: "ack", id, ok }) + "\n");
  }
  request<T>(method: string, values: Record<string, unknown> = {}, timeoutMs = 50_000): Promise<T> {
    this.start();
    if (!this.child?.stdin.writable || this.stopping) return Promise.reject(new MautrixError("connection_closed", method));
    const id = String(++this.next);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new MautrixError("timeout", method, method === "send"));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...values, method, id }) + "\n", error => {
        if (error && this.pending.delete(id)) { clearTimeout(timer); reject(new MautrixError("connection_closed", method, method === "send")); }
      });
    });
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
    this.stopPromise = new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end(); child.kill("SIGTERM");
    });
    return this.stopPromise;
  }
}
