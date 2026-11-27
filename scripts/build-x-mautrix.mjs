import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".local/bin", process.platform === "win32" ? "x-mautrix-bridge.exe" : "x-mautrix-bridge");
fs.mkdirSync(path.dirname(output), { recursive: true });
try {
  execFileSync(process.env.GO_BINARY || "go", ["build", "-mod=readonly", "-trimpath", "-o", output + ".tmp", "."], {
    cwd: path.join(root, "sync/mautrix"), stdio: "inherit",
  });
  fs.renameSync(output + ".tmp", output);
  console.log("X connector built. Set X_CONNECTOR=mautrix and restart sync to enable it, or select individual accounts as described in sync/mautrix/README.md.");
} finally {
  fs.rmSync(output + ".tmp", { force: true });
}
