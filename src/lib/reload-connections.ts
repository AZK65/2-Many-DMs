export async function reloadConnections(): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/reload`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch { return false; }
}
