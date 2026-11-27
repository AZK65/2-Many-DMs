import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import path from "node:path";
import { isXChatPin, type XUnlockState } from "../src/lib/x-unlock-state";

export type XPinStorageStatus = { available: boolean; saved: boolean; autoUnlock: boolean; error?: string };
type Command = "status" | "save" | "forget" | "take" | "resume";
type Reply = { saved?: boolean; autoUnlock?: boolean; pin?: string; error?: string };
export type PinTransport = (command: Command, pin?: string) => Promise<Reply>;
let build: Promise<void> | undefined;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function pinIdentity(accountId: string, sessionToken: string, dataDir = process.env.DATA_DIR || process.cwd()) {
  return { account: hash(JSON.stringify([path.resolve(dataDir), accountId])), binding: hash(sessionToken) };
}

function keychainTransport(accountId: string, sessionToken: string): PinTransport {
  const identity = pinIdentity(accountId, sessionToken);
  return async (command, pin) => {
    build ??= promisify(execFile)(process.execPath, [path.join(process.cwd(), "scripts/build-x-pin-keychain.mjs")], { timeout: 125_000 })
      .then(() => undefined).catch(() => { build = undefined; throw new Error("Keychain helper unavailable"); });
    await build;
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(process.env.DATA_DIR || process.cwd(), ".local/bin/x-pin-keychain"), [], { stdio: ["pipe", "pipe", "ignore"] });
      const timer = setTimeout(() => { child.kill(); reject(new Error("Keychain timeout")); }, 5000);
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; if (output.length > 4096) child.kill(); });
      child.on("error", () => { clearTimeout(timer); reject(new Error("Keychain unavailable")); });
      child.on("close", code => {
        clearTimeout(timer);
        try { if (code !== 0 || output.length > 4096) throw new Error(); resolve(JSON.parse(output)); }
        catch { reject(new Error("Keychain unavailable")); }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ command, ...identity, ...(pin ? { pin } : {}) }));
    });
  };
}

export class XPinMemory {
  constructor(private transport: PinTransport, private available = process.platform === "darwin") {}
  private unavailable(): XPinStorageStatus {
    return { available: false, saved: false, autoUnlock: false, error: this.available
      ? "Could not access macOS Keychain. Unlock your login keychain and try again."
      : "Remembering a PIN requires macOS Keychain on the computer running sync." };
  }
  async status(): Promise<XPinStorageStatus> {
    if (!this.available) return this.unavailable();
    try {
      const reply = await this.transport("status");
      if (reply.error) return this.unavailable();
      // Explicit projection: no secret may appear in any HTTP/status payload.
      return { available: true, saved: reply.saved === true, autoUnlock: reply.autoUnlock === true };
    } catch { return this.unavailable(); }
  }
  async forget(): Promise<XPinStorageStatus> {
    if (!this.available) return this.unavailable();
    try { const r = await this.transport("forget"); if (r.error) return this.unavailable(); return await this.status(); }
    catch { return this.unavailable(); }
  }
  async rememberVerified(pin: string, result: XUnlockState): Promise<XPinStorageStatus> {
    if (!this.available) return this.unavailable();
    if (!isXChatPin(pin) || result.state !== "unlocked" || result.pinVerified !== true) return {
      ...await this.status(), error: "PIN was not saved because X did not verify this code. Select Remember PIN the next time you unlock X."
    };
    try { const r = await this.transport("save", pin); if (r.error) return this.unavailable(); return await this.status(); }
    catch { return this.unavailable(); }
  }
  async restore(unlock: (pin: string) => Promise<XUnlockState>) {
    if (!this.available) return;
    try {
      const reply = await this.transport("take");
      if (reply.error || !isXChatPin(reply.pin)) return;
      const result = await unlock(reply.pin);
      // The helper left this entry paused before releasing the PIN. Only a
      // verified open inbox permits automatic use on a future restart.
      if (result.state === "unlocked") await this.transport("resume");
    } catch { /* Remain paused; no automatic retry and no raw secret/error logs. */ }
  }
}

export function xPinMemory(accountId: string, sessionToken: string) {
  return new XPinMemory(keychainTransport(accountId, sessionToken), process.platform === "darwin" && Boolean(sessionToken));
}

const pending = new Map<string, Promise<unknown>>();
export async function withXPinLock<T>(accountId: string, action: () => Promise<T>): Promise<T> {
  const task = (pending.get(accountId) || Promise.resolve()).catch(() => {}).then(action);
  pending.set(accountId, task);
  try { return await task; } finally { if (pending.get(accountId) === task) pending.delete(accountId); }
}
