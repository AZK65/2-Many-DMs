import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(exec);

const MANUAL = [
  "git pull",
  "npm install",
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
  });
}

async function runUpdate() {
  const s = state();
  const steps: [string, string][] = [
    ["Pulling latest code", "git pull --ff-only"],
    ["Installing dependencies", "npm install --no-audit --no-fund"],
    ["Building", "npm run build"],
  ];
  try {
    for (const [phase, cmd] of steps) {
      s.phase = phase;
      const { stdout, stderr } = await run(cmd, {
        cwd: process.cwd(),
        timeout: 8 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      });
      s.log += `\n$ ${cmd}\n${(stdout + stderr).trim()}\n`;
    }
    s.phase = "Restarting";
    s.done = true;
    s.restarting = true;
    s.running = false;
    // Restart so the freshly-built app loads. Relies on a supervisor
    // (pm2/systemd/Docker/Railway) restarting the process on exit, or a custom
    // UPDATE_RESTART_CMD (e.g. "pm2 restart all").
    const cmd = process.env.UPDATE_RESTART_CMD;
    setTimeout(() => {
      if (cmd) exec(cmd, { cwd: process.cwd() }, () => process.exit(0));
      else process.exit(0);
    }, 1500);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    s.error = (err.stderr || err.message || String(e)).trim();
    s.phase = "Failed";
    s.running = false;
  }
}

// Kick off the update (one at a time). Off unless ALLOW_SELF_UPDATE=1.
export async function POST() {
  if (process.env.ALLOW_SELF_UPDATE !== "1") {
    return NextResponse.json({
      ok: false,
      started: false,
      reason: "self-update-disabled",
      commands: MANUAL,
    });
  }
  const s = state();
  if (s.running) {
    return NextResponse.json(
      { ok: false, started: false, error: "Update already running." },
      { status: 409 }
    );
  }
  g.__upd = {
    running: true,
    phase: "Starting",
    log: "",
    error: null,
    done: false,
    restarting: false,
  };
  void runUpdate(); // fire and forget; progress via GET
  return NextResponse.json({ ok: true, started: true });
}

// Progress poller for the UI.
export async function GET() {
  return NextResponse.json(state());
}
