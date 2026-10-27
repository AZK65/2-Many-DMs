import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_NAME = ".omnicrm-sync.lock";
const OWNER_NAME = /^owner-([1-9]\d*)-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.json$/;
const EMPTY_LOCK_GRACE_MS = 10_000;

interface LockOptions {
  pid?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

export interface WorkerLock {
  directory: string;
  ownerFile: string;
  release(): void;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Lack of permission cannot establish that the owner has exited.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function removeOwner(directory: string, ownerFile: string): void {
  try {
    fs.unlinkSync(ownerFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    fs.rmdirSync(directory);
  } catch (error) {
    // A later owner has a DIFFERENT immutable marker. Never remove that file
    // or recursively remove the directory when our old ownership is released.
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
  }
}

/** One process owns the auth files even when another worker uses another port. */
export function acquireWorkerLock(dataDirectory: string, options: LockOptions = {}): WorkerLock {
  const pid = options.pid ?? process.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid worker PID");
  const now = options.now || Date.now;
  const alive = options.isProcessAlive || processIsAlive;
  fs.mkdirSync(dataDirectory, { recursive: true });
  const directory = path.join(fs.realpathSync(dataDirectory), LOCK_NAME);
  const token = randomUUID();
  const ownerName = `owner-${pid}-${token}.json`;
  const ownerFile = path.join(directory, ownerName);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = fs.lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Cannot verify sync ownership at ${directory}`);
      }
      const entries = fs.readdirSync(directory);
      const owners = entries.map((name) => ({ name, match: name.match(OWNER_NAME) }));
      if (owners.some(({ match }) => !match)) {
        throw new Error(`Unrecognized sync ownership record at ${directory}; refusing to open shared sessions`);
      }
      for (const { name, match } of owners) {
        const filename = path.join(directory, name);
        let valid = false;
        try {
          const metadata = fs.lstatSync(filename);
          const record = metadata.isFile() && !metadata.isSymbolicLink()
            ? JSON.parse(fs.readFileSync(filename, "utf8"))
            : null;
          valid = record?.pid === Number(match![1]) && record?.token === match![2] &&
            typeof record?.startedAt === "string" && Number.isFinite(Date.parse(record.startedAt));
        } catch { /* A partial or unknown record cannot establish dead ownership. */ }
        if (!valid) throw new Error(`Unrecognized sync ownership record at ${directory}; refusing to open shared sessions`);
      }
      const living = owners.find(({ match }) => alive(Number(match![1])));
      if (living) {
        throw new Error(`Sync already owns these sessions (PID ${living.match![1]})`);
      }
      if (!entries.length && now() - info.mtimeMs < EMPTY_LOCK_GRACE_MS) {
        throw new Error("Another sync worker is acquiring these sessions; retry shortly");
      }
      // Remove exact, verified-dead owner markers, never whatever marker may
      // replace them while another contender is also reclaiming a stale lock.
      for (const { name } of owners) {
        try { fs.unlinkSync(path.join(directory, name)); }
        catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        }
      }
      try { fs.rmdirSync(directory); }
      catch (cause) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((cause as NodeJS.ErrnoException).code || "")) throw cause;
      }
      continue;
    }

    try {
      fs.writeFileSync(ownerFile, JSON.stringify({ pid, token, startedAt: new Date(now()).toISOString() }), {
        flag: "wx",
        mode: 0o600,
      });
      const entries = fs.readdirSync(directory);
      // If a stale reclaimer removed/recreated the empty directory between
      // mkdir and writing our marker, only its single marker owner may win.
      if (entries.length !== 1 || entries[0] !== ownerName) {
        throw new Error("Concurrent sync startup detected; refusing to open shared sessions");
      }
      let released = false;
      return {
        directory,
        ownerFile,
        release() {
          if (released) return;
          removeOwner(directory, ownerFile);
          released = true;
        },
      };
    } catch (error) {
      removeOwner(directory, ownerFile);
      throw error;
    }
  }
  throw new Error("Sync ownership changed during startup; retry shortly");
}

/** X uses cwd auth; other connectors may use DATA_DIR. Protect both scopes. */
export function acquireWorkerLocks(directories: string[], options: LockOptions = {}): () => void {
  const locks: WorkerLock[] = [];
  try {
    for (const directory of [...new Set(directories.map((item) => {
      fs.mkdirSync(item, { recursive: true });
      return fs.realpathSync(item);
    }))].sort()) {
      locks.push(acquireWorkerLock(directory, options));
    }
  } catch (error) {
    for (const lock of locks.reverse()) lock.release();
    throw error;
  }
  return () => { for (const lock of locks) lock.release(); };
}
