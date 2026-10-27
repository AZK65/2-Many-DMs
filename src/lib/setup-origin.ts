/** Reject browser cross-site setup mutations. Not a replacement for owner authentication. */
export function sameSetupOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // local CLI callers do not send an Origin header
  try {
    const caller = new URL(origin);
    // Next can normalize req.url to localhost behind a local listener/proxy.
    // Host retains the address used by the browser, including its port.
    const host = request.headers.get("host") || new URL(request.url).host;
    return /^https?:$/.test(caller.protocol) && caller.host.toLowerCase() === host.toLowerCase();
  }
  catch { return false; }
}

export async function setupBody(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
