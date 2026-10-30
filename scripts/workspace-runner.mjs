// Per-workspace supervisor. Never receives the parent app's credentials.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse } from "dotenv";

const cwd = process.cwd();
const env = { ...process.env, ...parse(fs.readFileSync(path.join(cwd, ".env"))) };
if (!env.OMNI_WORKSPACE_ID || env.DATA_DIR !== cwd || env.OMNI_WORKSPACE_SUPERVISED !== "1") throw new Error("Refusing to start an unscoped workspace.");
const lock = path.join(cwd, ".workspace-runtime.lock");
try { fs.mkdirSync(lock, { mode: 0o700 }); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  let prior;
  try { prior = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")); } catch { process.exit(0); }
  try { process.kill(prior.pid, 0); process.exit(0); } catch (cause) { if (cause.code !== "ESRCH") process.exit(0); }
  fs.unlinkSync(path.join(lock, "owner.json")); fs.rmdirSync(lock); fs.mkdirSync(lock, { mode: 0o700 });
}
fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: "wx" });
let stopping = false;
const children = new Set();
function start(name, args) {
  if (stopping) return;
  const out = fs.openSync(path.join(cwd, name === "sync" ? "sync.log" : "web.log"), "a", 0o600);
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", out, out] });
  fs.closeSync(out); children.add(child);
  child.on("error", error => console.error(`[workspace] ${name} could not start: ${error.code || "error"}`));
  child.on("exit", () => { children.delete(child); if (!stopping) setTimeout(() => start(name, args), 3000); });
}
start("sync", ["--import", "tsx", "sync/worker.ts"]);
start("web", ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", env.PORT]);
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const until = Date.now() + 15_000;
  while (children.size && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  if (!children.size) { fs.unlinkSync(path.join(lock, "owner.json")); fs.rmdirSync(lock); }
  process.exit(0);
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
