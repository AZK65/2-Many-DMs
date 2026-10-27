import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const macAppCli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const candidates = [
  process.env.OMNI_TAILSCALE_CLI,
  "tailscale",
  existsSync(macAppCli) ? macAppCli : null,
].filter(Boolean);
const env = { ...process.env, TAILSCALE_BE_CLI: "1" };

let cli = null;
for (const candidate of candidates) {
  const check = spawnSync(candidate, ["version"], { env, stdio: "ignore" });
  if (!check.error && check.status === 0) {
    cli = candidate;
    break;
  }
}

if (!cli) {
  console.error(
    "Tailscale's CLI was not found. Install Tailscale and enable its CLI integration, " +
      "or set OMNI_TAILSCALE_CLI to the executable path."
  );
  process.exit(1);
}

const port = process.env.OMNI_PRIVATE_PORT || "3000";
if (!/^\d+$/.test(port)) {
  console.error("OMNI_PRIVATE_PORT must be a numeric port.");
  process.exit(1);
}

const serve = spawnSync(cli, ["serve", "--bg", port], { env, stdio: "inherit" });
if (serve.status !== 0) process.exit(serve.status ?? 1);

const status = spawnSync(cli, ["serve", "status"], { env, stdio: "inherit" });
process.exit(status.status ?? 1);
