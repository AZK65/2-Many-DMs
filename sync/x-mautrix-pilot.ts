import fs from "node:fs";
import path from "node:path";

export function mautrixPilotEnabled(accountId: string): boolean {
  if (process.env.X_CONNECTOR === "browser") return false;
  if (process.env.X_CONNECTOR === "mautrix") return true;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || process.cwd(), ".local/x-mautrix-pilot.json"), "utf8"));
    return Array.isArray(config.accounts) && config.accounts.includes(accountId);
  } catch { return false; }
}

export function xBrowserConversationId(id: string): string {
  return /^\d+:\d+$/.test(id) ? id.replace(":", "-") : id;
}
export function xMautrixConversationId(id: string): string {
  return /^\d+-\d+$/.test(id) ? id.replace("-", ":") : id;
}
