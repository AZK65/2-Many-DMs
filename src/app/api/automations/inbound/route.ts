import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runAutomation } from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the sync worker after a newly received live DM. Only explicitly
// instant keyword rules run here; scheduled/manual rules remain untouched.
export async function POST(req: NextRequest) {
  const { conversationId } = await req.json().catch(() => ({}));
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  const rules = await prisma.automation.findMany({
    where: { enabled: true, schedule: "instant", trigger: "keyword" },
  });
  const results = [];
  for (const rule of rules) {
    results.push({ id: rule.id, ...(await runAutomation(rule.id, conversationId)) });
  }
  return NextResponse.json({ ok: true, results });
}
