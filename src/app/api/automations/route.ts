import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  automationToDTO,
  matchConversations,
  sanitizeAutomationInput,
} from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const autos = await prisma.automation.findMany({
    orderBy: { createdAt: "desc" },
  });
  const data = await Promise.all(
    autos.map(async (a) => automationToDTO(a, (await matchConversations(a)).length))
  );
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const a = await prisma.automation.create({
    data: sanitizeAutomationInput(body),
  });
  return NextResponse.json(automationToDTO(a, (await matchConversations(a)).length));
}
