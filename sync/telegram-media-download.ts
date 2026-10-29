import path from "node:path";
import type { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";

type DownloadInput = {
  apiId: number; apiHash: string; session: string;
  media: Uint8Array; thumb?: number; maxBytes: number;
  profile?: { id: string; isGroup: boolean };
};
type DownloadWorker = Pick<EventEmitter, "once"> & Pick<Worker, "terminate">;
type WorkerFactory = (input: DownloadInput) => DownloadWorker;

/** A timeout must close the download transport before releasing its queue slot.
 * Keep media separate from the live Telegram connection so retrying a photo
 * never reconnects chats or loses incoming updates. */
export class TelegramMediaDownloader {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private stopped = false;
  private cancel?: () => void;
  private blockedUntil = 0;
  constructor(private createWorker: WorkerFactory = input => new Worker(
    path.join(process.cwd(), "sync", "telegram-media-download-worker.cjs"),
    { workerData: input, execArgv: [] }
  ), private timeoutMs = 90_000) {}

  download(input: DownloadInput): Promise<Buffer> {
    if (this.stopped) return Promise.reject(Error("Telegram media recovery has stopped"));
    if (this.pending >= 16) return Promise.reject(Error("Telegram downloads are busy. Try again shortly."));
    this.pending++;
    const task = this.tail.then(async () => {
      if (this.stopped) throw Error("Telegram media recovery has stopped");
      if (Date.now() < this.blockedUntil) throw Object.assign(Error("Telegram asked us to pause downloads. Please try again later."), {
        seconds: Math.ceil((this.blockedUntil - Date.now()) / 1000),
      });
      const worker = this.createWorker(input);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<Buffer>((resolve, reject) => {
          this.cancel = () => reject(Error("Telegram media recovery has stopped"));
          timer = setTimeout(() => reject(Error("Telegram attachment download stalled. Please try Recover again.")), this.timeoutMs);
          worker.once("error", reject);
          worker.once("exit", () => reject(Error("Telegram download ended before the file was received")));
          worker.once("message", (result: { bytes?: Uint8Array; error?: string; seconds?: number; unavailable?: boolean }) => {
            if (result.error) {
              const seconds = Number(result.seconds || /FLOOD(?:_PREMIUM)?_WAIT[_ ](\d+)/i.exec(result.error)?.[1] || 0);
              if (seconds > 0) this.blockedUntil = Date.now() + seconds * 1000;
              reject(Object.assign(Error(result.error), { seconds }));
            } else if (result.unavailable && input.profile) {
              resolve(Buffer.alloc(0));
            } else if (result.bytes?.length && result.bytes.length <= input.maxBytes) {
              resolve(Buffer.from(result.bytes));
            } else reject(Error("Telegram returned an empty or oversized attachment"));
          });
        });
      } finally {
        clearTimeout(timer);
        this.cancel = undefined;
        // Await actual socket/thread disposal, never release on Promise.race alone.
        await worker.terminate();
      }
    });
    const settled = task.finally(() => { this.pending--; });
    this.tail = settled.catch(() => {});
    return settled;
  }

  async stop() {
    this.stopped = true;
    this.cancel?.();
    await this.tail;
  }
}
