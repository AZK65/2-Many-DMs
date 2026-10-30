import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LABEL = "com.2manydms.omnicrm.sync";

function launchTarget(): string | null {
  if (process.env.OMNI_WORKSPACE_ID) return null;
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return null;
  }
  const label = process.env.OMNI_SYNC_LAUNCH_AGENT || DEFAULT_LABEL;
  return `gui/${process.getuid()}/${label}`;
}

export async function managedSyncServiceLoaded(): Promise<boolean> {
  const target = launchTarget();
  if (!target) return false;
  try {
    await execFileAsync("launchctl", ["print", target], { timeout: 5_000 });
    return true;
  } catch (error) {
    const result = error as { stderr?: string };
    if (/Could not find service/i.test(result.stderr || "")) return false;
    // Uncertainty is not permission to start an unmanaged second worker.
    throw new Error("Could not verify the managed sync service. Please retry in a moment.");
  }
}

export async function managedSyncServicePid(): Promise<number | null> {
  const target = launchTarget();
  if (!target) return null;
  const { stdout } = await execFileAsync("launchctl", ["print", target], {
    timeout: 5_000,
  });
  const match = stdout.match(/^\s*pid = (\d+)\s*$/m);
  const pid = match ? Number(match[1]) : null;
  return pid && pid > 1 && pid !== process.pid ? pid : null;
}

export async function kickstartManagedSyncService(
  restart = false,
): Promise<void> {
  const target = launchTarget();
  if (!target) throw new Error("The managed sync service is not available.");
  await execFileAsync("launchctl", ["kickstart", ...(restart ? ["-k"] : []), target], {
    timeout: 10_000,
  });
}
