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
  "# then restart the app (and the sync worker)",
];

// Pull the latest code. Off by default — a self-hoster opts in with
// ALLOW_SELF_UPDATE=1, since pulling + rebuilding a running server is
// environment-specific (and on Railway a git push already redeploys). When
// disabled we just hand back the manual commands.
export async function POST() {
  if (process.env.ALLOW_SELF_UPDATE !== "1") {
    return NextResponse.json(
      {
        ok: false,
        applied: false,
        reason: "self-update-disabled",
        commands: MANUAL,
      },
      { status: 200 }
    );
  }
  try {
    const { stdout, stderr } = await run("git pull --ff-only", {
      cwd: process.cwd(),
      timeout: 60_000,
    });
    return NextResponse.json({
      ok: true,
      applied: true,
      output: (stdout + stderr).trim(),
      next: "Run `npm install && npm run build`, then restart the app + worker.",
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return NextResponse.json(
      {
        ok: false,
        applied: false,
        error: (err.stderr || err.message || String(e)).trim(),
        commands: MANUAL,
      },
      { status: 500 }
    );
  }
}
