import { setupBody } from "@/lib/setup-origin";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { claimPairCode, releasePairCode, completePairCode, pairStatus } from "@/lib/pairing";
import { validXSession } from "@/lib/connection-setup";
import { reloadConnections } from "@/lib/reload-connections";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
export function OPTIONS() { return new NextResponse(null, { headers: CORS }); }
export async function POST(req: NextRequest) {
  const { code, authToken, ct0 } = await setupBody(req);
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: CORS });
  // Validate before claiming the one-time code so fixable input errors do not burn it.
  if (typeof authToken !== "string" || typeof ct0 !== "string" || !validXSession(authToken, ct0)) return reply({ error: "Sign into x.com in this browser, then connect again from the extension." }, 400);
  if (typeof code !== "string") return reply({ error: "Enter the pairing code shown in the app." }, 400);
  const existing = pairStatus(code);
  if (existing?.accountId) return reply({ ok: true, accountId: existing.accountId });
  const userId = claimPairCode(code);
  if (!userId) return reply({ error: existing?.busy ? "Connection is already being saved. Wait a moment, then check the app." : "This pairing code expired. Generate a new one in the app." }, existing?.busy ? 409 : 401);
  try {
    const session = encrypt(JSON.stringify({ authToken, ct0 }));
    // No extra inbox polling or guessed identity during login. The worker verifies connectivity.
    const label = "X account · " + createHash("sha256").update(authToken).digest("hex").slice(0, 10);
    const account = await prisma.account.upsert({
      where: { userId_platform_label: { userId, platform: "x", label } },
      create: { userId, platform: "x", label, status: "pending", driver: process.env.X_DRIVER === "api" ? "api" : "browser", session },
      update: { status: "pending", session, detail: null },
    });
    completePairCode(code, account.id);
    const workerReloaded = await reloadConnections();
    return reply({ ok: true, accountId: account.id, workerReloaded });
  } catch {
    releasePairCode(code);
    return reply({ error: "Could not securely save the session. Check the server database and APP_ENCRYPTION_KEY, then retry with the same code." }, 503);
  }
}
