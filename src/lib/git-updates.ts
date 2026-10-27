import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = Number(process.env.UPDATE_GIT_TIMEOUT_MS || 15000);

export interface GitUpdateEntry {
  version: string;
  sha: string;
  date?: string;
  title?: string;
  notes?: string[];
}

export interface GitUpdateInfo {
  current: string;
  latest: string;
  currentSha: string;
  latestSha: string;
  hasUpdate: boolean;
  behindCount: number;
  aheadCount: number;
  dirty: boolean;
  canApply: boolean;
  blockedReason: string | null;
  branch: string;
  targetRef: string;
  remote: string;
  repoUrl: string | null;
  entries: GitUpdateEntry[];
  checkedAt: string;
}

export async function runGit(args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 5 * 1024 * 1024,
    env: process.env,
  });
  return stdout.trim();
}

function safeRepoUrl(remoteUrl: string): string | null {
  const ssh = remoteUrl.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (ssh) return `https://github.com/${ssh[1].replace(/\.git$/i, "")}`;
  try {
    const url = new URL(remoteUrl);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const repo = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    return repo ? `https://github.com/${repo}` : null;
  } catch {
    return null;
  }
}

function parseEntries(raw: string): GitUpdateEntry[] {
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = "", date = "", title = "", body = ""] = record.split("\x1f");
      const notes = body
        .split("\n")
        .map((line) => line.trim().replace(/^[-*]\s+/, ""))
        .filter(Boolean)
        .slice(0, 8);
      return {
        version: sha.slice(0, 7),
        sha,
        date: date || undefined,
        title: title || "Code update",
        notes,
      };
    });
}

export async function inspectGitUpdates(fetchRemote = true): Promise<GitUpdateInfo> {
  const currentSha = await runGit(["rev-parse", "HEAD"]);
  const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
    () => "detached"
  );
  const configuredRemote = process.env.UPDATE_GIT_REMOTE || "origin";
  const configuredBranch = process.env.UPDATE_GIT_BRANCH || (branch === "detached" ? "master" : branch);
  const upstream = await runGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]).catch(() => `${configuredRemote}/${configuredBranch}`);
  const slash = upstream.indexOf("/");
  const remote = slash > 0 ? upstream.slice(0, slash) : configuredRemote;
  const remoteBranch = slash > 0 ? upstream.slice(slash + 1) : configuredBranch;
  const targetRef = `${remote}/${remoteBranch}`;

  if (fetchRemote) {
    await runGit(["fetch", "--quiet", "--prune", remote, remoteBranch]);
  }

  const latestSha = await runGit(["rev-parse", targetRef]);
  const behindCount = Number(await runGit(["rev-list", "--count", `${currentSha}..${latestSha}`])) || 0;
  const aheadCount = Number(await runGit(["rev-list", "--count", `${latestSha}..${currentSha}`])) || 0;
  const dirty = Boolean(await runGit(["status", "--porcelain", "--untracked-files=normal"]));
  const hasUpdate = behindCount > 0;
  const canApply = hasUpdate && aheadCount === 0 && !dirty && branch !== "detached";
  const blockedReason = !hasUpdate
    ? null
    : dirty
      ? "This installation has local code changes. Commit or stash them before updating."
      : aheadCount > 0
        ? "This installation has local commits and cannot fast-forward safely."
        : branch === "detached"
          ? "This installation is on a detached Git revision."
          : null;
  const log = hasUpdate
    ? await runGit([
        "log",
        "--reverse",
        "--date=short",
        "--format=%H%x1f%ad%x1f%s%x1f%b%x1e",
        `${currentSha}..${latestSha}`,
        "-n",
        "25",
      ])
    : "";
  const remoteUrl = await runGit(["remote", "get-url", remote]).catch(() => "");

  return {
    current: currentSha.slice(0, 7),
    latest: latestSha.slice(0, 7),
    currentSha,
    latestSha,
    hasUpdate,
    behindCount,
    aheadCount,
    dirty,
    canApply,
    blockedReason,
    branch,
    targetRef,
    remote,
    repoUrl: safeRepoUrl(remoteUrl),
    entries: parseEntries(log),
    checkedAt: new Date().toISOString(),
  };
}
