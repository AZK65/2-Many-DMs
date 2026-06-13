import { prisma } from "./db";
import type { NextRequest } from "next/server";

// Extract the caller's real IP (behind Railway/any proxy) for proxy-region
// matching and signup attribution.
export function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

// PLACEHOLDER until real auth (email magic-link / OAuth) lands. For now the app
// is single-tenant in practice: we resolve to one demo user so the multi-tenant
// data model is exercised end-to-end. Swap this for the authenticated session.
export async function getCurrentUser(ip?: string | null) {
  const email = "you@omni-crm.local";
  return prisma.user.upsert({
    where: { email },
    create: { email, name: "You", signupIp: ip ?? undefined },
    update: ip ? { signupIp: ip } : {},
  });
}
