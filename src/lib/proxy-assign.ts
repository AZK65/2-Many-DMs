import { prisma } from "./db";
import type { Proxy, User } from "@prisma/client";

// Best-effort geolocation of the user's IP → ISO country code, used to match a
// proxy in the same region so the account looks like it's logging in from home.
export async function geolocateIp(ip: string): Promise<string | null> {
  if (!ip || ip === "127.0.0.1" || ip.startsWith("::")) return null;
  try {
    const res = await fetch(`https://ipapi.co/${ip}/country/`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const cc = (await res.text()).trim();
    return /^[A-Z]{2}$/.test(cc) ? cc : null;
  } catch {
    return null;
  }
}

// Allocate a sticky proxy in the user's region. Tries, in order: a free proxy
// from the pool in the matching region, a freshly provisioned mobile proxy, any
// free proxy, then the PROXY_URL fallback. Marks it in-use so it stays pinned.
export async function assignProxy(user: User): Promise<Proxy | null> {
  const region = user.signupIp ? await geolocateIp(user.signupIp) : null;

  // 1. A free proxy already in the pool for this region (preferred), else any.
  let proxy =
    (region &&
      (await prisma.proxy.findFirst({ where: { inUse: false, region } }))) ||
    null;

  // 2. Provision a fresh sticky mobile IP from the configured provider.
  if (!proxy) {
    const provisioned = await provisionMobileProxy(region);
    if (provisioned) {
      proxy = await prisma.proxy.create({ data: provisioned });
    }
  }

  // 3. Any free proxy, regardless of region.
  if (!proxy) {
    proxy = await prisma.proxy.findFirst({ where: { inUse: false } });
  }

  // 4. Last resort: the single shared PROXY_URL env (manual / dev).
  if (!proxy && process.env.PROXY_URL) {
    proxy = await prisma.proxy.create({
      data: { url: process.env.PROXY_URL, region, provider: "manual" },
    });
  }

  if (proxy && !proxy.inUse) {
    proxy = await prisma.proxy.update({
      where: { id: proxy.id },
      data: { inUse: true },
    });
  }
  return proxy;
}

// TODO: integrate a mobile/5G proxy provider (Bright Data, Soax, IPRoyal…).
// Given a region, call their API to allocate a sticky residential/mobile port
// and return the upstream URL. Returns null until a provider is configured.
async function provisionMobileProxy(
  _region: string | null
): Promise<{ url: string; region: string | null; provider: string } | null> {
  // e.g. const { url } = await brightData.allocateMobile({ country: region });
  return null;
}
