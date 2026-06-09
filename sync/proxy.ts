import { anonymizeProxy } from "proxy-chain";

let resolved: string | null | undefined;

// Returns a Chromium-ready `--proxy-server` value for the configured PROXY_URL,
// or null if none is set. Chrome's --proxy-server can't take inline user:pass,
// so proxy-chain spins up a local forwarder that embeds the upstream auth.
// PROXY_URL format: http://user:pass@host:port  (use a sticky residential proxy
// geo-matched to where the account normally logs in).
export async function chromeProxyServer(): Promise<string | null> {
  if (resolved !== undefined) return resolved;
  const url = process.env.PROXY_URL;
  if (!url) {
    resolved = null;
    return null;
  }
  try {
    resolved = await anonymizeProxy(url);
    console.log("[proxy] browsers routed through PROXY_URL");
  } catch (e) {
    console.error("[proxy] setup failed — using direct connection:", e);
    resolved = null;
  }
  return resolved;
}

// Chrome args to add a proxy (empty when none configured).
export function proxyArgs(server: string | null): string[] {
  return server ? [`--proxy-server=${server}`] : [];
}
