import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { livePlatformStatuses } from "@/lib/connection-status";
import {
  kickstartManagedSyncService,
  managedSyncServiceLoaded,
  managedSyncServicePid,
} from "@/lib/managed-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RestartPhase =
  | "idle"
  | "stopping"
  | "starting"
  | "connecting"
  | "ready"
  | "attention"
  | "error";

type RestartLog = {
  at: string;
  message: string;
  tone: "normal" | "success" | "warning" | "error";
};

type PlatformStatus = {
  platform: string;
  state: "starting" | "qr" | "ready" | "disconnected" | "disabled";
  detail?: string;
};

type RestartState = {
  runId: string | null;
  phase: RestartPhase;
  startedAt: string | null;
  finishedAt: string | null;
  pid: number | null;
  logs: RestartLog[];
  platforms: Record<string, PlatformStatus>;
};

const restartGlobal = globalThis as typeof globalThis & {
  __omniWorkerRestartState?: RestartState;
  __omniWorkerRestartPromise?: Promise<void>;
  __omniWorkerStartingAt?: number;
  __omniWorkerRestarting?: boolean;
};

const execFileAsync = promisify(execFile);
const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";

function initialState(): RestartState {
  return {
    runId: null,
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    pid: null,
    logs: [],
    platforms: {},
  };
}

function state(): RestartState {
  restartGlobal.__omniWorkerRestartState ??= initialState();
  return restartGlobal.__omniWorkerRestartState;
}

function isLocal(req: NextRequest): boolean {
  if (process.env.ALLOW_WORKER_CONTROL === "1") return true;
  const host = (req.headers.get("host") || "")
    .split(":")[0]
    .replace(/[[\]]/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function log(
  message: string,
  tone: RestartLog["tone"] = "normal",
): void {
  const current = state();
  current.logs.push({ at: new Date().toISOString(), message, tone });
  current.logs = current.logs.slice(-40);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function controlFetch(
  pathname: string,
  init?: RequestInit,
  timeoutMs = 2_000,
): Promise<Response | null> {
  try {
    return await fetch(`${controlUrl}${pathname}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

async function workerUp(): Promise<boolean> {
  return Boolean((await controlFetch("/health"))?.ok);
}

async function waitForWorker(up: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await workerUp()) === up) return true;
    await delay(300);
  }
  return (await workerUp()) === up;
}

async function listenerPids(): Promise<number[]> {
  try {
    const configuredPort = new URL(controlUrl).port || "4001";
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-tiTCP:${configuredPort}`,
      "-sTCP:LISTEN",
    ], { timeout: 3_000 });
    return stdout
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  } catch {
    return [];
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A permissions error is not evidence that a process has exited.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessesToExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processIsRunning(pid))) return true;
    await delay(300);
  }
  return pids.every((pid) => !processIsRunning(pid));
}

async function stopExistingWorker(managed: boolean): Promise<void> {
  if (!(await workerUp())) {
    // The ordinary auto-start route may have spawned a worker that has not
    // bound its health port yet. Give that launch a moment so it can be shut
    // down instead of creating a duplicate process.
    const startedAt = restartGlobal.__omniWorkerStartingAt || 0;
    if (Date.now() - startedAt < 20_000) {
      log("Waiting for the current sync launch to settle…");
      await waitForWorker(true, 12_000);
    }
  }

  // Capture the OLD process before shutdown. A KeepAlive service may already
  // have replaced it by the time we check again; never signal its replacement.
  const managedPid = managed ? await managedSyncServicePid() : null;
  const pids = managedPid ? [managedPid] : await listenerPids();
  const reachable = await workerUp();
  if (!reachable && !pids.length) {
    log("No active sync service found. Starting clean.");
    return;
  }
  if (reachable && pids.length !== 1) {
    throw new Error("Could not identify a single sync process to restart safely. Please retry.");
  }

  log("Stopping the current sync service…");
  const shutdown = reachable
    ? await controlFetch("/shutdown", {
      method: "POST",
      ...(pids.length === 1 ? { headers: { "x-omni-expected-worker-pid": String(pids[0]) } } : {}),
    }, 3_000)
    : null;
  const stopped = () => pids.length
    ? waitForProcessesToExit(pids, 15_000)
    : waitForWorker(false, 15_000);
  if (shutdown?.ok && (await stopped())) {
    log("Previous sync service stopped cleanly.", "success");
    return;
  }

  // Supports workers launched before the /shutdown endpoint existed. The
  // target is resolved from the exact local control port before signalling.
  for (const pid of pids) {
    if (!processIsRunning(pid)) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have completed its own shutdown between checks.
    }
  }
  if (pids.length && (await stopped())) {
    log("Previous sync service stopped cleanly.", "success");
    return;
  }
  if (pids.some(processIsRunning) || (pids.length === 0 && await workerUp())) {
    throw new Error("The previous sync service did not stop. Try again.");
  }
}

function spawnWorker(): number | null {
  const logPath = path.join(process.cwd(), "sync.log");
  fs.appendFileSync(
    logPath,
    `\n[manual restart] ${new Date().toISOString()}\n`,
    "utf8",
  );
  const output = fs.openSync(logPath, "a");
  try {
    const child = spawn("npm", ["run", "sync"], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", output, output],
      env: process.env,
    });
    child.unref();
    return child.pid ?? null;
  } finally {
    fs.closeSync(output);
  }
}

function platformLabel(platform: string): string {
  if (platform === "x") return "X";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function statusLabel(status: PlatformStatus): string {
  if (status.state === "ready") return "connected";
  if (status.state === "qr") return "needs a QR scan";
  if (status.state === "disconnected") return "needs attention";
  return "starting";
}

async function monitorConnections(): Promise<void> {
  const seen = new Map<string, string>();
  const startupDeadline = Date.now() + 6 * 60_000;
  let connectionDeadline: number | undefined;
  // Browser connectors start in stages. Give them the connection window only
  // after initial registration has settled, not while later accounts are still
  // waiting their turn. The outer ceiling also bounds a failed startup.
  while (Date.now() < startupDeadline && (!connectionDeadline || Date.now() < connectionDeadline)) {
    const response = await controlFetch("/status", undefined, 3_000);
    if (response?.ok) {
      const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!raw) {
        await delay(1_000);
        continue;
      }
      if (raw.initialized !== false && !connectionDeadline) {
        connectionDeadline = Date.now() + 90_000;
      }
      const platforms: Record<string, PlatformStatus> = {};
      for (const [platform, value] of Object.entries(raw)) {
        if (platform === "accounts" || !value || typeof value !== "object") continue;
        const candidate = value as Partial<PlatformStatus>;
        if (
          typeof candidate.state !== "string" ||
          !["starting", "qr", "ready", "disconnected", "disabled"].includes(
            candidate.state,
          )
        ) continue;
        platforms[platform] = {
          platform,
          state: candidate.state as PlatformStatus["state"],
          ...(typeof candidate.detail === "string"
            ? { detail: candidate.detail.slice(0, 160) }
            : {}),
        };
      }
      state().platforms = platforms;

      const configured = Object.values(platforms).filter(
        (platform) => platform.state !== "disabled",
      );
      for (const platform of configured) {
        if (seen.get(platform.platform) === platform.state) continue;
        seen.set(platform.platform, platform.state);
        log(
          `${platformLabel(platform.platform)} ${statusLabel(platform)}.`,
          platform.state === "ready"
            ? "success"
            : platform.state === "disconnected" || platform.state === "qr"
              ? "warning"
              : "normal",
        );
      }

      const accountStatuses = raw.accounts && typeof raw.accounts === "object"
        ? Object.values(raw.accounts as Record<string, Partial<PlatformStatus>>)
        : [];
      const allAccountsReady = accountStatuses.every(
        (account) => account?.state === "ready" || account?.state === "disabled",
      );
      if (
        raw.initialized !== false && configured.length && allAccountsReady &&
        configured.every((platform) => platform.state === "ready")
      ) {
        state().phase = "ready";
        state().finishedAt = new Date().toISOString();
        log("Launch successful. All messaging connections are ready.", "success");
        return;
      }
    }
    await delay(1_000);
  }

  state().phase = "attention";
  state().finishedAt = new Date().toISOString();
  log("Sync launched, but one or more connections still need attention.", "warning");
}

async function runRestart(): Promise<void> {
  try {
    const managed = await managedSyncServiceLoaded();
    state().phase = "stopping";
    await stopExistingWorker(managed);

    state().phase = "starting";
    log("Launching a fresh sync service…");
    restartGlobal.__omniWorkerStartingAt = Date.now();
    if (managed) {
      // launchd is the single process owner on the desktop install. Starting
      // another detached worker here races it for port 4001 and can invalidate
      // Telegram's saved authorization key.
      // KeepAlive may have already started the replacement after /shutdown.
      // A plain kickstart is idempotent; -k would kill that fresh worker again.
      await kickstartManagedSyncService();
      state().pid = null;
    } else {
      state().pid = spawnWorker();
    }
    if (!(await waitForWorker(true, 30_000))) {
      throw new Error("The sync service did not answer after launch. Check sync.log.");
    }

    state().phase = "connecting";
    log("Sync service is running. Connecting your accounts…", "success");
    await monitorConnections();
  } catch (error) {
    state().phase = "error";
    state().finishedAt = new Date().toISOString();
    log(
      error instanceof Error ? error.message : "The sync service could not restart.",
      "error",
    );
  } finally {
    restartGlobal.__omniWorkerRestarting = false;
    delete restartGlobal.__omniWorkerRestartPromise;
  }
}

function snapshot(): RestartState & { running: boolean } {
  const current = state();
  return {
    ...current,
    logs: [...current.logs],
    platforms: { ...current.platforms },
    running: ["stopping", "starting", "connecting"].includes(current.phase),
  };
}

export async function POST(req: NextRequest) {
  if (!isLocal(req)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Restart is only available on localhost. Set ALLOW_WORKER_CONTROL=1 to override.",
      },
      { status: 403 },
    );
  }

  if (restartGlobal.__omniWorkerRestartPromise) {
    return NextResponse.json({ ok: true, ...snapshot() });
  }

  restartGlobal.__omniWorkerRestartState = {
    ...initialState(),
    runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phase: "stopping",
    startedAt: new Date().toISOString(),
  };
  restartGlobal.__omniWorkerRestarting = true;
  log("Restart requested from Omni.");
  restartGlobal.__omniWorkerRestartPromise = runRestart();

  return NextResponse.json({ ok: true, ...snapshot() }, { status: 202 });
}

export async function GET() {
  const response = await controlFetch("/status", undefined, 3000);
  const raw = response?.ok ? await response.json().catch(() => null) : null;
  return NextResponse.json({ ok: true, ...snapshot(), platforms: livePlatformStatuses(raw) });
}
