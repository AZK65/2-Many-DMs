import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  kickstartManagedSyncService,
  managedSyncServiceLoaded,
} from "@/lib/managed-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workerStartState = globalThis as typeof globalThis & {
  __omniWorkerStartingAt?: number;
  __omniWorkerRestarting?: boolean;
};
const WORKER_START_GRACE_MS = 20_000;

// Spawning the sync worker is a local-dev convenience. Restrict to localhost so
// a hosted/exposed instance can't be made to launch processes; a non-local
// self-host can opt in with ALLOW_WORKER_CONTROL=1.
function isLocal(req: NextRequest): boolean {
  if (process.env.ALLOW_WORKER_CONTROL === "1") return true;
  const host = (req.headers.get("host") || "").split(":")[0].replace(/[[\]]/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function workerUp(): Promise<boolean> {
  const url = (process.env.SYNC_CONTROL_URL || "http://localhost:4001") + "/health";
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!isLocal(req)) {
    return NextResponse.json(
      { ok: false, error: "Only available on localhost (set ALLOW_WORKER_CONTROL=1 to override)." },
      { status: 403 }
    );
  }
  if (await workerUp()) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (workerStartState.__omniWorkerRestarting) {
    return NextResponse.json({ ok: true, starting: true, restarting: true });
  }
  const now = Date.now();
  if (
    workerStartState.__omniWorkerStartingAt &&
    now - workerStartState.__omniWorkerStartingAt < WORKER_START_GRACE_MS
  ) {
    return NextResponse.json({ ok: true, starting: true });
  }
  // Multiple panels can probe this route while the worker is still binding
  // its health port. Claim one shared startup window before spawning so those
  // concurrent probes cannot launch competing workers against the same X
  // browser profile.
  workerStartState.__omniWorkerStartingAt = now;
  try {
    // The desktop install owns a launchd service that survives sign-out and
    // Mac restarts. Let it own the worker process too: spawning a second copy
    // here makes both copies use the same Telegram auth key, which Telegram
    // permanently invalidates as AUTH_KEY_DUPLICATED.
    if (await managedSyncServiceLoaded()) {
      await kickstartManagedSyncService();
      return NextResponse.json({ ok: true, started: true, managed: true });
    }

    // Detach so the worker keeps running after this request; logs → sync.log.
    const out = fs.openSync(path.join(process.cwd(), "sync.log"), "a");
    try {
      const child = spawn("npm", ["run", "sync"], {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", out, out],
        env: process.env,
      });
      child.unref();
      return NextResponse.json({ ok: true, started: true, pid: child.pid, log: "sync.log" });
    } finally {
      fs.closeSync(out);
    }
  } catch (e) {
    delete workerStartState.__omniWorkerStartingAt;
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// Lightweight "is the worker up?" probe for the UI to poll after starting.
export async function GET() {
  return NextResponse.json({ running: await workerUp() });
}
