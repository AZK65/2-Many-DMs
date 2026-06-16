import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

// Self-host admin action: launch the one-time XChat unlock. It opens a REAL,
// headful X window on this machine where the user types their passcode directly
// (the app never sees it). Only works where there's a display — on a headless
// server the child can't open a window, so the UI also shows the terminal
// command as a fallback. Not reachable on the public marketing site (the
// MARKETING_ONLY middleware redirects /api/* to /landing).
export async function POST() {
  try {
    const child = spawn("npx", ["tsx", "sync/x-unlock.ts"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    return NextResponse.json({ ok: true, started: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
