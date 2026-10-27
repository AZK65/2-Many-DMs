import { syncHealthView, type SyncHealth } from "./sync-health";
export type LiveConnectionState = "starting" | "qr" | "ready" | "disconnected" | "disabled";

// A stored account is configuration, not proof of a live connection.
export function accountStatusView(_account: { status: string }, live?: { state: LiveConnectionState; sync?: SyncHealth }) {
  if (live?.state === "ready") {
    const health = syncHealthView({ platform: "", ...live });
    return { connected: true, label: live.sync ? health.label : "Connected", tone: health.tone === "neutral" ? "progress" : health.tone } as const;
  }
  if (live?.state === "starting") return { connected: false, label: "Connecting…", tone: "progress" } as const;
  if (live?.state === "qr") return { connected: false, label: "Scan QR", tone: "progress" } as const;
  if (live?.state === "disconnected") return { connected: false, label: "Needs attention", tone: "attention" } as const;
  return { connected: false, label: live ? "Not running" : "Status unavailable", tone: "attention" } as const;
}

// Restart logs are historical; connection badges must use a fresh snapshot.
// Explicitly select fields so QR credentials are never copied into restart logs.
export function livePlatformStatuses(raw: Record<string, unknown> | null) {
  const result: Record<string, { platform: string; state: LiveConnectionState; detail?: string; sync?: SyncHealth }> = {};
  for (const [platform, value] of Object.entries(raw || {})) {
    if (platform === "accounts" || !value || typeof value !== "object") continue;
    const candidate = value as { state?: string; detail?: string; sync?: SyncHealth };
    if (!["starting", "qr", "ready", "disconnected", "disabled"].includes(candidate.state || "")) continue;
    result[platform] = {
      platform, state: candidate.state as LiveConnectionState,
      ...(typeof candidate.detail === "string" ? { detail: candidate.detail.slice(0, 160) } : {}),
      ...(candidate.sync ? { sync: { lastCheckedAt: candidate.sync.lastCheckedAt, lastMessageAt: candidate.sync.lastMessageAt,
        pendingChats: candidate.sync.pendingChats, blockedChats: candidate.sync.blockedChats, retryAt: candidate.sync.retryAt } } : {}),
    };
  }
  return result;
}
