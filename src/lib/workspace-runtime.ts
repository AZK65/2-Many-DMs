import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { acquireWorkerLock } from "../../sync/worker-lock";
import { workspaceIdValid, workspaceName, type WorkspaceSummary } from "./workspace-types";

const execFileAsync = promisify(execFile);
type Record = WorkspaceSummary & { webPort: number; syncPort: number; homeUrl: string };
const root = () => process.cwd();
const catalog = () => path.join(root(), ".local", "workspaces");
const removed = () => path.join(root(), ".local", "removed-workspaces");
const directory = (id: string) => {
  if (!workspaceIdValid(id)) throw new Error("Unknown workspace.");
  return path.join(catalog(), id);
};
const recordFile = (id: string) => path.join(directory(id), "workspace.json");
const summary = ({ id, name, createdAt, setupComplete, state }: Record): WorkspaceSummary => ({ id, name, createdAt, setupComplete, state });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const currentWorkspaceId = () => process.env.OMNI_WORKSPACE_ID || "default";
export const isolatedWorkspace = () => currentWorkspaceId() !== "default";

export async function mainWorkspaceName() {
  try { return workspaceName(JSON.parse(await fs.readFile(path.join(catalog(), "main.json"), "utf8")).name); }
  catch (error: any) { if (error.code === "ENOENT") return "Main workspace"; throw error; }
}

async function assertWorkspaceDirectory(id: string) {
  const target = directory(id);
  const info = await fs.lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(target) !== target) throw new Error("Workspace path is not safe to modify.");
  return target;
}

async function readRecord(id: string): Promise<Record> {
  const value = JSON.parse(await fs.readFile(recordFile(id), "utf8")) as Record;
  if (value.id !== id || !Number.isInteger(value.webPort) || !Number.isInteger(value.syncPort) || value.webPort < 1024 || value.syncPort !== value.webPort + 1 || value.syncPort > 65535) throw new Error("Workspace configuration is invalid.");
  return value;
}

async function writeRecord(record: Record) {
  const file = recordFile(record.id);
  const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  await fs.writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
  await fs.rename(temp, file);
}

// Cross-process lock: simultaneous create/open requests cannot initialize or
// launch two runtimes against the same session directory.
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(catalog(), { recursive: true, mode: 0o700 });
  const until = Date.now() + 90_000;
  while (true) {
    let lock;
    try { lock = acquireWorkerLock(catalog()); }
    catch (error) {
      if (Date.now() >= until) throw new Error("Another workspace is being prepared. Please retry shortly.");
      if (!/already owns|acquiring|Concurrent|ownership changed/.test(String(error))) throw error;
      await sleep(200); continue;
    }
    try { return await fn(); } finally { lock.release(); }
  }
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const entries = await fs.readdir(catalog()).catch(error => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const rows = await Promise.all(entries.filter(workspaceIdValid).map(readRecord));
  return [{ id: "default", name: await mainWorkspaceName(), createdAt: null, setupComplete: true, state: "ready" }, ...rows.sort((a, b) => a.createdAt!.localeCompare(b.createdAt!)).map(summary)];
}

async function free(port: number) {
  return new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function allocatePorts() {
  const records = await listWorkspaces();
  const used = new Set<number>();
  for (const item of records.filter(item => item.id !== "default")) {
    const record = await readRecord(item.id); used.add(record.webPort); used.add(record.syncPort);
  }
  for (let port = 27800; port < 28000; port += 2) {
    if (!used.has(port) && !used.has(port + 1) && await free(port) && await free(port + 1)) return port;
  }
  throw new Error("No free workspace ports are available on this computer.");
}

// An allowlist, never {...process.env}: no source account, proxy, AI,
// sharing or publishing credential is inherited by a fresh workspace.
export function cleanWorkspaceEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", ...Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR", "LANG", "LC_ALL", "DISPLAY", "XAUTHORITY"]
    .flatMap(key => source[key] ? [[key, source[key]!]] : [])) };
}

export async function copyWorkspaceApplication(target: string) {
  const build = process.env.OMNI_NEXT_DIST_DIR || ".next";
  await fs.access(path.join(root(), build, "BUILD_ID")).catch(() => { throw new Error("Build 2Many before creating a workspace. Your current workspace is unchanged."); });
  const filter = (file: string) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && path.basename(file) !== "cache";
  // Copy code, never the repository tree: no .env, DB, uploads, screenshots,
  // connector profiles, export files, git history or personal setup scripts.
  for (const folder of ["src", "sync"]) await fs.cp(path.join(root(), folder), path.join(target, folder), { recursive: true, filter });
  await fs.cp(path.join(root(), build), path.join(target, ".next"), { recursive: true, filter });
  await fs.mkdir(path.join(target, "prisma"), { recursive: true });
  await fs.copyFile(path.join(root(), "prisma/schema.prisma"), path.join(target, "prisma/schema.prisma"));
  for (const file of ["package.json", "tsconfig.json", "next.config.js", "next-env.d.ts"]) await fs.copyFile(path.join(root(), file), path.join(target, file));
  await fs.mkdir(path.join(target, "scripts"), { recursive: true });
  await fs.copyFile(path.join(root(), "scripts/workspace-runner.mjs"), path.join(target, "scripts/workspace-runner.mjs"));
  await fs.mkdir(path.join(target, "extension"), { recursive: true });
  for (const name of ["manifest.json", "popup.html", "popup.js", "README.md"]) await fs.copyFile(path.join(root(), "extension", name), path.join(target, "extension", name));
  await fs.mkdir(path.join(target, "public"), { recursive: true });
  for (const name of ["brand", "icon-192.png", "icon-512.png", "pdf.worker.min.mjs", "downloads/omni-dictation-macos.zip"]) {
    const from = path.join(root(), "public", name);
    if (await fs.stat(from).catch(() => null)) { await fs.mkdir(path.dirname(path.join(target, "public", name)), { recursive: true }); await fs.cp(from, path.join(target, "public", name), { recursive: true }); }
  }
  await fs.mkdir(path.join(target, "node_modules"), { recursive: true });
  for (const name of await fs.readdir(path.join(root(), "node_modules"))) {
    if ([".prisma", "@prisma", ".cache"].includes(name)) continue;
    const link = path.join(target, "node_modules", name);
    if (!(await fs.lstat(link).catch(() => null))) await fs.symlink(path.join(root(), "node_modules", name), link, "dir");
  }
  // Prisma resolves .env relative to its generated client, not just cwd.
  // Keep both client packages LOCAL so it cannot silently load the main .env.
  for (const name of [".prisma", "@prisma/client"]) await fs.cp(path.join(root(), "node_modules", name), path.join(target, "node_modules", name), { recursive: true });
}

async function initialize(record: Record) {
  const target = directory(record.id);
  await copyWorkspaceApplication(target);
  const environment = {
    NODE_ENV: "production", DATABASE_URL: `file:${path.join(target, "workspace.db")}`,
    DATA_DIR: target, APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    OMNI_WORKSPACE_ID: record.id, OMNI_WORKSPACE_HOME_URL: record.homeUrl,
    OMNI_WORKSPACE_SUPERVISED: "1", OMNI_NEXT_DIST_DIR: ".next",
    SYNC_CONTROL_PORT: String(record.syncPort), SYNC_CONTROL_URL: `http://127.0.0.1:${record.syncPort}`,
    SYNC_CONTROL_HOST: "127.0.0.1", WEB_URL: `http://127.0.0.1:${record.webPort}`,
    PORT: String(record.webPort), WHATSAPP_DRIVER: "baileys", X_DRIVER: "browser",
    OCR_ENABLED: "0",
  };
  // Write once. Retrying a failed creation MUST NOT rotate a session key or
  // replace a database that the user may already have begun using.
  await fs.writeFile(path.join(target, ".env"), Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600, flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
  await fs.writeFile(path.join(target, "workspace.db"), "", { mode: 0o600, flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
  await execFileAsync(process.execPath, [path.join(root(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.join(target, "prisma/schema.prisma")], {
    cwd: target, env: { ...cleanWorkspaceEnvironment(), DATABASE_URL: environment.DATABASE_URL }, timeout: 45_000, maxBuffer: 1_000_000,
  }).catch(() => { throw new Error("Workspace storage could not be prepared. Retry with the same name; your existing data is untouched."); });
}

async function running(record: Record) {
  try {
    const response = await fetch(`http://127.0.0.1:${record.webPort}/api/workspaces/identity`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!response.ok || (await response.json()).id !== record.id) return false;
    const worker = await fetch(`http://127.0.0.1:${record.syncPort}/health`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    const health = await worker.json();
    return worker.ok && health.ok && health.workspaceId === record.id;
  } catch { return false; }
}

async function launch(record: Record) {
  if (await running(record)) return;
  const target = directory(record.id);
  const file = await fs.open(path.join(target, "runtime.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, [path.join(target, "scripts/workspace-runner.mjs")], {
      cwd: target, env: cleanWorkspaceEnvironment(), detached: true, stdio: ["ignore", file.fd, file.fd],
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
  } finally { await file.close(); }
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) { if (await running(record)) return; await sleep(300); }
  throw new Error("Workspace is saved but could not start. Open it again to retry; no accounts were copied.");
}

export async function createWorkspace(nameInput: unknown, id: unknown, homeUrl: string) {
  const name = workspaceName(nameInput);
  if (!workspaceIdValid(id)) throw new Error("A valid creation request is required. Reopen setup and retry.");
  return locked(async () => {
    if (await fs.lstat(path.join(removed(), id)).catch(() => null)) throw new Error("This workspace was removed. Start a new setup instead.");
    let record = await readRecord(id).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (record && record.name !== name) throw new Error("This creation request belongs to another workspace. Reopen setup.");
    if (!record) {
      const existing = await listWorkspaces();
      if (existing.some(row => row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A workspace with that name already exists. Open it from the menu.");
      const limit = Math.max(2, Math.min(100, Number(process.env.OMNI_WORKSPACE_LIMIT) || 8));
      if (existing.length >= limit) throw new Error(`This installation supports ${limit} workspaces. Increase OMNI_WORKSPACE_LIMIT only if the computer has enough memory for more background services.`);
      const disk = await fs.statfs(catalog());
      if (disk.bavail * disk.bsize < 512 * 1024 * 1024) throw new Error("Free at least 512 MB of disk space before creating another workspace.");
      const port = await allocatePorts();
      record = { id, name, createdAt: new Date().toISOString(), setupComplete: false, state: "creating", webPort: port, syncPort: port + 1, homeUrl };
      await fs.mkdir(directory(id), { mode: 0o700 }); await writeRecord(record);
    }
    try {
      if (record.state !== "ready") { await initialize(record); record.state = "ready"; await writeRecord(record); }
      await launch(record);
      return { workspace: summary(record), url: `http://127.0.0.1:${record.webPort}/welcome` };
    } catch (error) {
      if (record.state !== "ready") { record.state = "error"; await writeRecord(record); }
      throw error;
    }
  });
}

export async function openWorkspace(id: string, homeUrl: string) {
  if (id === "default") return { url: `${homeUrl}/` };
  return locked(async () => {
    const record = await readRecord(id);
    if (record.state !== "ready") { await initialize(record); record.state = "ready"; await writeRecord(record); }
    await launch(record);
    return { url: `http://127.0.0.1:${record.webPort}/${record.setupComplete ? "" : "welcome"}` };
  });
}

export async function finishWorkspace(id: string) {
  return locked(async () => { const record = await readRecord(id); record.setupComplete = true; await writeRecord(record); return { ok: true }; });
}

export async function renameWorkspace(id: string, nameInput: unknown) {
  const name = workspaceName(nameInput);
  if (id !== "default" && !workspaceIdValid(id)) throw new Error("Unknown workspace.");
  return locked(async () => {
    const rows = await listWorkspaces();
    if (rows.some(row => row.id !== id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A workspace with that name already exists.");
    if (id === "default") {
      const file = path.join(catalog(), "main.json");
      const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ name }), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, file);
    } else {
      await assertWorkspaceDirectory(id);
      const record = await readRecord(id); record.name = name; await writeRecord(record);
    }
    return { ok: true, name };
  });
}

// Never kill by port, broad process name, or an unverified stale PID. Stop only
// the supervisor whose command and private directory match this exact record.
async function stopWorkspace(record: Record, target: string) {
  const lockFile = path.join(target, ".workspace-runtime.lock", "owner.json");
  const owner = await fs.readFile(lockFile, "utf8").then(JSON.parse).catch((error: any) => { if (error.code === "ENOENT") return null; throw error; });
  if (owner) {
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 1 || owner.pid === process.pid) throw new Error("Workspace runtime identity could not be verified. Nothing was removed.");
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error: any) { if (error.code === "ESRCH") alive = false; else throw error; }
    if (alive) {
      const { stdout } = await execFileAsync("ps", ["-p", String(owner.pid), "-o", "command="]);
      if (stdout.trim() !== `${process.execPath} ${path.join(target, "scripts/workspace-runner.mjs")}`) throw new Error("Workspace runtime identity changed. Nothing was removed.");
      process.kill(owner.pid, "SIGTERM");
    }
  }
  const deadline = Date.now() + 25_000;
  while (true) {
    let alive = false;
    if (owner) { try { process.kill(owner.pid, 0); alive = true; } catch (error: any) { if (error.code !== "ESRCH") throw error; } }
    if (!alive && await free(record.webPort) && await free(record.syncPort)) return;
    if (Date.now() > deadline) throw new Error("Workspace is still stopping. Nothing was removed. Wait a moment and retry.");
    await sleep(250);
  }
}

export async function removeWorkspace(id: string, confirmation: unknown) {
  if (id === "default") throw new Error("The main workspace cannot be removed.");
  if (!workspaceIdValid(id)) throw new Error("Unknown workspace.");
  return locked(async () => {
    const destination = path.join(removed(), id);
    // A response lost after the atomic move is safe to retry, never re-created.
    const backup = await fs.lstat(destination).catch(() => null);
    if (backup) {
      if (backup.isSymbolicLink() || !backup.isDirectory() || await fs.realpath(destination) !== destination) throw new Error("Backup path is invalid.");
      const record = JSON.parse(await fs.readFile(path.join(destination, "workspace.json"), "utf8"));
      if (record.id !== id || confirmation !== record.name) throw new Error("Type the exact workspace name to confirm removal.");
      return { ok: true, backupPath: destination };
    }
    const target = await assertWorkspaceDirectory(id);
    const record = await readRecord(id);
    if (confirmation !== record.name) throw new Error("Type the exact workspace name to confirm removal.");
    await stopWorkspace(record, target);
    await fs.mkdir(removed(), { recursive: true, mode: 0o700 });
    if (await fs.realpath(removed()) !== removed()) throw new Error("Backup directory is not safe. Nothing was removed.");
    // Atomic same-volume move retains all DB, encryption keys, sessions and
    // media. This is recoverable removal, not account deletion or remote logout.
    await fs.rename(target, destination);
    return { ok: true, backupPath: destination };
  });
}
