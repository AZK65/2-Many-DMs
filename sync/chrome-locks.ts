import fs from "node:fs";
import path from "node:path";

// A crashed or force-killed Chromium leaves Singleton* lock files in its
// profile that block the next launch ("browser is already running"). Removing
// them makes restarts clean — used by both the WhatsApp and X adapters.
export function cleanChromeLocks(profileDir: string): void {
  const names = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  for (const dir of [profileDir, path.join(profileDir, "Default")]) {
    for (const n of names) {
      try {
        fs.unlinkSync(path.join(dir, n));
        console.log(`[chrome] removed stale lock: ${path.join(dir, n)}`);
      } catch {
        /* not present — fine */
      }
    }
  }
}

// Hardened Chromium flags for headless use (avoids /dev/shm exhaustion and GPU
// crashes). Do NOT add --single-process / --no-zygote: they crash Chromium
// before pages finish loading on current builds.
export const HARDENED_CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--no-first-run",
  // Drastically cut Chrome's process count (site isolation spawns one process
  // per frame/site — a single heavy SPA can balloon to ~100 procs and OOM the
  // box). These keep each browser lean enough to run WhatsApp + X together.
  "--disable-features=site-per-process,IsolateOrigins",
  "--renderer-process-limit=4",
];
