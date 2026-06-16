import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    clearTimeout(t);
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
  try {
    // Detach so the worker keeps running after this request; logs → sync.log.
    const out = fs.openSync(path.join(process.cwd(), "sync.log"), "a");
    const child = spawn("npm", ["run", "sync"], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    child.unref();
    return NextResponse.json({ ok: true, started: true, pid: child.pid, log: "sync.log" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// Lightweight "is the worker up?" probe for the UI to poll after starting.
export async function GET() {
  return NextResponse.json({ running: await workerUp() });
}
