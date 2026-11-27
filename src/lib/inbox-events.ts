import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Worker and web server are separate processes. This file carries only a
// revision notification; messages and identities always stay behind normal APIs.
const directory = () => path.join(process.env.DATA_DIR || process.cwd(), ".local", "inbox-events");
let pending: ReturnType<typeof setTimeout> | undefined;
export function publishInboxChange() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = undefined;
    try {
      const dir = directory();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "revision"), randomUUID());
    } catch { /* Live notifications are optional; durable storage and polling win. */ }
  }, 20);
  pending.unref?.();
}

export function inboxEventStream(signal: AbortSignal, dir = directory()) {
  let dispose = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let queued: ReturnType<typeof setTimeout> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let watcher: fs.FSWatcher | undefined;
      const encoder = new TextEncoder();
      const send = (frame: string) => {
        if (closed) return;
        // A stalled browser must not accumulate an unbounded response queue.
        if ((controller.desiredSize ?? 1) <= 0) { dispose(); return; }
        try { controller.enqueue(encoder.encode(frame)); } catch { dispose(); }
      };
      dispose = () => {
        if (closed) return;
        closed = true;
        clearTimeout(queued); clearInterval(heartbeat); watcher?.close();
        signal.removeEventListener("abort", dispose);
        try { controller.close(); } catch { /* Already cancelled by the client. */ }
      };
      signal.addEventListener("abort", dispose, { once: true });
      if (signal.aborted) { dispose(); return; }
      try {
        fs.mkdirSync(dir, { recursive: true });
        watcher = fs.watch(dir, (_event, file) => {
          if (file !== "revision" || queued) return;
          queued = setTimeout(() => { queued = undefined; send("event: change\ndata: {}\n\n"); }, 20);
        });
        watcher.on("error", dispose);
        send("retry: 2000\nevent: ready\ndata: {}\n\n");
        heartbeat = setInterval(() => send(": keepalive\n\n"), 15_000);
        heartbeat.unref?.();
      } catch { dispose(); }
    },
    cancel() { dispose(); },
  });
}
