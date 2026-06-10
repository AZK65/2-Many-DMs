import { anonymizeProxy } from "proxy-chain";

// Cache one local forwarder per upstream proxy so many accounts sharing a
// proxy don't spawn duplicate ports.
const cache = new Map<string, string | null>();

// Resolve a Chromium `--proxy-server` value for a SPECIFIC account's proxy
// (pass the account's PROXY_URL), falling back to the global PROXY_URL env for
// single-user mode. Returns null = direct connection. Chrome can't take inline
// user:pass, so proxy-chain runs a local forwarder that embeds the auth.
// PROXY_URL format: http://user:pass@host:port (sticky residential, geo-matched).
export async function chromeProxyServer(
  proxyUrl?: string
): Promise<string | null> {
  const upstream = proxyUrl || process.env.PROXY_URL || "";
  if (!upstream) return null;
  if (cache.has(upstream)) return cache.get(upstream)!;
  try {
    const local = await anonymizeProxy(upstream);
    cache.set(upstream, local);
    console.log("[proxy] forwarder ready for upstream proxy");
    return local;
  } catch (e) {
    console.error("[proxy] setup failed — using direct connection:", e);
    cache.set(upstream, null);
    return null;
  }
}

// Chrome args to apply a proxy (empty when none).
export function proxyArgs(server: string | null): string[] {
  return server ? [`--proxy-server=${server}`] : [];
}
