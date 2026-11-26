import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { acquireWorkerLock } from "../../sync/worker-lock";

export type AgentKey = {
  id: string;
  name: string;
  accountIds: string[];
  createdAt: string;
  digest: string;
};
type AccessFile = { version: 1; keys: AgentKey[] };
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const publicAgentKey = ({ digest: _digest, ...key }: AgentKey) => key;

// Workspace-local, outside Git. Only a digest is persisted, never the bearer key.
export function agentAccessStore(root = process.env.DATA_DIR || process.cwd()) {
  const directory = path.join(root, ".local", "mcp");
  const filename = path.join(directory, "access.json");
  function read(): AccessFile {
    try {
      const value = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (
        value.version !== 1 ||
        !Array.isArray(value.keys) ||
        value.keys.length > 32 ||
        value.keys.some(
          (key: AgentKey) =>
            typeof key.id !== "string" ||
            typeof key.name !== "string" ||
            !/^[a-f0-9]{64}$/.test(key.digest) ||
            !Array.isArray(key.accountIds) ||
            !key.accountIds.every((id) => typeof id === "string") ||
            typeof key.createdAt !== "string",
        )
      )
        throw new Error();
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, keys: [] };
      throw new Error(
        "Agent access settings could not be read. Access is disabled until they are repaired.",
      );
    }
  }
  function change(transform: (value: AccessFile) => void) {
    const lock = acquireWorkerLock(directory);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const value = read();
      transform(value);
      fs.writeFileSync(temporary, JSON.stringify(value), {
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temporary, filename);
    } finally {
      try {
        fs.rmSync(temporary, { force: true });
      } finally {
        lock.release();
      }
    }
  }
  return {
    list: () => read().keys.map(publicAgentKey),
    create(name: string, accountIds: string[]) {
      if (
        !name.trim() ||
        name.trim().length > 60 ||
        !accountIds.length ||
        accountIds.length > 100
      )
        throw new Error("Enter an agent name and choose at least one account.");
      const token = `tmd_mcp_${randomBytes(32).toString("base64url")}`;
      const key: AgentKey = {
        id: randomUUID(),
        name: name.trim(),
        accountIds: [...new Set(accountIds)],
        digest: hash(token),
        createdAt: new Date().toISOString(),
      };
      change((value) => {
        if (value.keys.length >= 32)
          throw new Error(
            "Revoke an unused key before adding another agent (32 maximum).",
          );
        value.keys.push(key);
      });
      return { key: publicAgentKey(key), token };
    },
    revoke(id: string) {
      change((value) => {
        value.keys = value.keys.filter((key) => key.id !== id);
      });
    },
    authenticate(header: string | null) {
      const match = /^Bearer (tmd_mcp_[A-Za-z0-9_-]{43})$/.exec(header || "");
      if (!match) return null;
      const digest = Buffer.from(hash(match[1]), "hex");
      return (
        read().keys.find((key) =>
          timingSafeEqual(Buffer.from(key.digest, "hex"), digest),
        ) || null
      );
    },
  };
}

const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
export function mcpRequestAllowed(request: Request, owner = false) {
  if (process.env.MARKETING_ONLY === "1") return false;
  const host = request.headers.get("host") || "";
  let allowed = loopback.test(host);
  if (!owner && process.env.MCP_PUBLIC_URL) {
    try {
      const configured = new URL(process.env.MCP_PUBLIC_URL);
      allowed ||= configured.protocol === "https:" && configured.host === host;
    } catch {
      /* An invalid remote address never grants access. */
    }
  }
  if (!allowed) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (
        parsed.host !== host ||
        !["http:", "https:"].includes(parsed.protocol) ||
        (!loopback.test(host) && parsed.protocol !== "https:")
      )
        return false;
    } catch {
      return false;
    }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  // This custom header makes key management unavailable to cross-site forms.
  return !owner || request.headers.get("x-tmd-agent-settings") === "1";
}

const buckets = new Map<
  string,
  { start: number; count: number; active: number }
>();
export function claimAgentRequest(id: string, now = Date.now()) {
  for (const [key, value] of buckets)
    if (!value.active && now - value.start >= 60_000) buckets.delete(key);
  const value = buckets.get(id) || { start: now, count: 0, active: 0 };
  if (value.count >= 60 || value.active >= 4) return null;
  value.count++;
  value.active++;
  buckets.set(id, value);
  return () => {
    value.active--;
  };
}
