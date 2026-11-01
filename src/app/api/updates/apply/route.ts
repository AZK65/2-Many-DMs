import { NextRequest, NextResponse } from "next/server";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectGitUpdates } from "@/lib/git-updates";
import path from "node:path";
import { acquireWorkerLock, type WorkerLock } from "../../../../../sync/worker-lock";
import { updatePreferenceStore, validUpdateRevision } from "@/lib/update-preferences";
import { updateMutationAllowed } from "@/lib/update-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runFile = promisify(execFile);

const MANUAL = [
  "git fetch origin",
  "git merge --ff-only origin/master",
  "npm install",
  "npx prisma generate",
  "npx prisma db push --skip-generate",
  "npm run build",
  "# then restart the app + sync worker",
];

// Update runs async (a build takes a minute+, longer than a request), so we
// keep progress on a global the status GET can read. Survives module re-eval;
// reset on each run.
type UState = {
  running: boolean;
  phase: string;
  log: string;
  error: string | null;
  done: boolean;
  restarting: boolean;
  restartRequired: boolean;
  installedRevision: string | null;
};
const g = globalThis as unknown as { __upd?: UState };
function state(): UState {
  return (g.__upd ||= {
    running: false,
    phase: "idle",
    log: "",
    error: null,
    done: false,
    restarting: false,
    restartRequired: false,
    installedRevision: null,
  });
}

async function runStep(phase: string, command: string, args: string[]) {
  const s = state();
  s.phase = phase;
  const { stdout, stderr } = await runFile(command, args, {
    cwd: process.cwd(),
    timeout: 8 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });
  s.log += `\n$ ${[command, ...args].join(" ")}\n${(stdout + stderr).trim()}\n`;
}

async function runUpdate(expectedRevision: string, automatic: boolean, lock: WorkerLock) {
  const s = state();
  try {
    s.phase = "Checking Git";
    const update = await inspectGitUpdates(true);
    if (!update.hasUpdate) throw new Error("This installation is already current.");
    if (expectedRevision && update.latestSha !== expectedRevision)
      throw new Error("A newer update appeared. Review it before installing.");
    if (!update.canApply)
      throw new Error(update.blockedReason || "This update cannot be applied safely.");

    // Re-read consent after the network check, immediately before any mutation.
    // Persist the attempt so a failure/restart cannot cause an automatic loop.
    if (automatic) updatePreferenceStore().claimAutomatic(expectedRevision);

    await runStep("Pulling latest code", "git", ["merge", "--ff-only", update.latestSha]);
    await runStep("Installing dependencies", "npm", ["install", "--no-audit", "--no-fund"]);
    await runStep("Generating database client", "npx", ["prisma", "generate"]);
    await runStep("Applying database changes", "npx", ["prisma", "db", "push", "--skip-generate"]);
    await runStep("Building OmniCRM", "npm", ["run", "build"]);

    s.installedRevision = update.latestSha;
    s.done = true;
    s.running = false;
    const cmd = process.env.UPDATE_RESTART_CMD;
    const supervised = process.env.NODE_ENV === "production";
    s.restarting = Boolean(cmd) || supervised;
    s.restartRequired = !s.restarting;
    s.phase = s.restarting ? "Restarting" : "Installed — restart required";
    if (s.restarting) {
      // In production, Docker/Railway/pm2 restarts the process after exit. A
      // custom command supports launchd and other device-level supervisors.
      setTimeout(() => {
        if (cmd) exec(cmd, { cwd: process.cwd() }, () => process.exit(0));
        else process.exit(0);
      }, 1500);
    }
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    s.error = (err.stderr || err.message || String(e)).trim();
    s.phase = "Failed";
    s.running = false;
  } finally {
    lock.release();
  }
}

// Kick off one guarded fast-forward update at a time.
export async function POST(req: NextRequest) {
  if (!updateMutationAllowed(req)) {
    return NextResponse.json({
      ok: false,
      started: false,
      reason: "self-update-disabled",
      commands: MANUAL,
    });
  }
  const body = await req.json().catch(() => null) as { expectedRevision?: unknown; automatic?: unknown } | null;
  if (!body || !validUpdateRevision(body.expectedRevision) || (body.automatic !== undefined && typeof body.automatic !== "boolean")) {
    return NextResponse.json({ ok: false, started: false, error: "Review a valid update before installing." }, { status: 400 });
  }
  const s = state();
  if (s.running) {
    return NextResponse.json(
      { ok: false, started: false, error: "Update already running." },
      { status: 409 }
    );
  }
  let lock: WorkerLock;
  try { lock = acquireWorkerLock(path.join(process.cwd(), ".local", "updates", "installation")); }
  catch { return NextResponse.json({ ok: false, started: false, error: "Another update is running. Wait for it to finish." }, { status: 409 }); }
  g.__upd = {
    running: true,
    phase: "Starting",
    log: "",
    error: null,
    done: false,
    restarting: false,
    restartRequired: false,
    installedRevision: null,
  };
  void runUpdate(body.expectedRevision, body.automatic === true, lock); // progress via GET
  return NextResponse.json({ ok: true, started: true });
}

// Progress poller for the UI.
export async function GET() {
  return NextResponse.json(state());
}
