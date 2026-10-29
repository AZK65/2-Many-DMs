import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const statusFile = () => path.join(process.env.DATA_DIR || process.cwd(), ".local", "discord-login", "status.json");
function localRequest(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  try {
    return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) &&
      (!origin || new URL(origin).host === host) && req.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}
async function readStatus() {
  try { return JSON.parse(await fs.readFile(statusFile(), "utf8")); }
  catch { return {}; }
}
async function loginCapability() {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return { canLaunch: false, reason: "Discord sign-in needs a desktop session with Chrome. A headless server cannot open this login window." };
  }
  if (process.platform === "darwin") {
    try { await fs.access("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"); }
    catch { return { canLaunch: false, reason: "Install Google Chrome in Applications on this computer, then reopen setup." }; }
  }
  return { canLaunch: true };
}
export async function GET(req: NextRequest) {
  if (!localRequest(req)) return NextResponse.json({ error: "Open Omni on this computer to connect Discord search." }, { status: 403 });
  const current = await readStatus();
  if (["starting", "waiting"].includes(current.state) && current.pid) {
    try { process.kill(current.pid, 0); }
    catch { current.state = "error"; current.detail = "The sign-in window closed. Open it again to continue; saved messages are unchanged."; }
  }
  return NextResponse.json({ state: current.state || "idle", detail: current.detail, updatedAt: current.updatedAt, accountId: current.accountId, ...await loginCapability() });
}
export async function POST(req: NextRequest) {
  if (!localRequest(req)) return NextResponse.json({ error: "Open Omni on this computer to connect Discord search." }, { status: 403 });
  const capability = await loginCapability();
  if (!capability.canLaunch) return NextResponse.json({ error: capability.reason }, { status: 409 });
  const current = await readStatus();
  if (current.pid && ["starting", "waiting"].includes(current.state)) {
    try { process.kill(current.pid, 0); if (current.version >= 2) process.kill(current.pid, "SIGUSR1"); return NextResponse.json({ ok: true, alreadyOpen: true }); } catch { /* previous window closed */ }
  }
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "sync/discord-login.ts"], { cwd: process.cwd(), env: process.env, detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not open the Discord login window on this computer." }, { status: 500 }); }
}
