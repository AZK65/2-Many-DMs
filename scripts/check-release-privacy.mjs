import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const git = (args, input) => execFileSync("git", args, { input, maxBuffer: 128 * 1024 * 1024 });
const ownFiles = new Set(["scripts/check-release-privacy.mjs", "scripts/check-release-privacy.test.mjs"]);
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ["service-token", /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/],
  ["AWS-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Google-API-key", /\bAIza[A-Za-z0-9_-]{35}\b/],
  ["API-secret", /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{30,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["session-material", /"(?:noiseKey|signedIdentityKey|signedPreKey|advSecretKey)"\s*:/],
  ["Telegram-session", /StringSession\(["'][A-Za-z0-9+/=]{100,}["']\)/],
  ["assigned-secret", /(?:auth_token|ct0|api_hash|api_key|access_token|refresh_token|client_secret|password)\s*[=:]\s*["'][A-Za-z0-9_+/.=-]{24,}["']/i],
  ["personal-email", /\b[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|icloud|yahoo)\.com\b/i],
  ["personal-home-path", /\/(?:Users|home)\/(?!example\b|user\b|runner\b|node\b)[A-Za-z0-9._-]+/],
];

export function privatePath(name) {
  if (name === ".env.example") return false;
  return /(?:^|\/)(?:\.env(?:\.[^/]+)?|\.baileys_auth|\.wwebjs_auth|\.wwebjs_cache|\.x_auth|\.x_profile[^/]*|\.local|\.chat-history|\.git|outputs?|backups?|creds\.json|id_rsa|id_ed25519)(?:\/|$)|\.(?:db|sqlite|sqlite3)(?:$|[-.])|\.(?:pem|p12|pfx|key|bundle|log)$|^public\/(?:media|avatars)\//i.test(name);
}

export function inspect(name, data) {
  const findings = [];
  if (privatePath(name)) findings.push({ file: name, rule: "private-file" });
  // Rules and their synthetic test inputs deliberately contain token signatures.
  if (ownFiles.has(name) || data.includes(0)) return findings;
  for (const [index, line] of data.toString("utf8").split("\n").entries()) {
    for (const [rule, pattern] of rules) {
      if (pattern.test(line)) findings.push({ file: name, line: index + 1, rule });
    }
  }
  return findings;
}

export function checkWorkingTree() {
  const names = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
  const findings = [];
  for (const name of new Set(names)) {
    if (!fs.existsSync(name)) continue;
    if (fs.lstatSync(name).isSymbolicLink()) findings.push({ file: name, rule: "symlink-needs-review" });
    else findings.push(...inspect(name, fs.readFileSync(name)));
  }
  return { files: names.length, findings };
}

export function checkHistory() {
  const objects = git(["rev-list", "--objects", "--all"]).toString().trim().split("\n").map(line => {
    const split = line.indexOf(" ");
    return { id: split < 0 ? line : line.slice(0, split), file: split < 0 ? "" : line.slice(split + 1) };
  });
  const meta = git(["cat-file", "--batch-check=%(objectname) %(objecttype)"], objects.map(o => o.id).join("\n") + "\n").toString().trim().split("\n");
  const blobs = objects.filter((_, i) => meta[i].endsWith(" blob"));
  const data = git(["cat-file", "--batch"], blobs.map(o => o.id).join("\n") + "\n");
  const findings = [];
  let offset = 0;
  for (const blob of blobs) {
    const end = data.indexOf(10, offset);
    const size = Number(data.subarray(offset, end).toString().split(" ")[2]);
    const content = data.subarray(end + 1, end + 1 + size);
    offset = end + 1 + size + 1;
    findings.push(...inspect(blob.file, content).map(finding => ({ ...finding, object: blob.id.slice(0, 12) })));
  }
  const commits = git(["rev-list", "--all"]).toString().trim().split("\n");
  // Inspect every tree, not only rev-list's first pathname for a reused blob.
  for (const commit of commits) {
    const tree = git(["ls-tree", "-r", "--name-only", "-z", commit]).toString().split("\0").filter(Boolean);
    for (const file of tree) if (privatePath(file)) findings.push({ file, rule: "historical-private-file", commit: commit.slice(0, 12) });
    const metadata = git(["show", "-s", "--format=%an <%ae>%n%cn <%ce>%n%B", commit]).toString();
    if (metadata.split("\n").slice(0, 2).some(line => !/<[^<>]+@users\.noreply\.github\.com>$/.test(line))) {
      findings.push({ rule: "non-private-Git-identity", commit: commit.slice(0, 12) });
    }
    findings.push(...inspect("commit-message", Buffer.from(metadata.split("\n").slice(2).join("\n"))).map(finding => ({ ...finding, commit: commit.slice(0, 12) })));
  }
  return { files: blobs.length, commits: commits.length, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = process.argv.includes("--history") ? checkHistory() : checkWorkingTree();
  // Never print matched values: logs can themselves become a credential leak.
  console.log(JSON.stringify({ checkedFiles: report.files, checkedCommits: report.commits, findings: report.findings }, null, 2));
  if (report.findings.length) process.exitCode = 1;
  else console.log("PASS: privacy checks. Image contents and unknown secret formats still require human review.");
}
