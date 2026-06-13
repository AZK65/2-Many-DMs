import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  automationToDTO,
  matchConversations,
  sanitizeAutomationInput,
} from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  // Allow a lightweight enable/disable toggle without a full payload.
  if (
    typeof body.enabled === "boolean" &&
    Object.keys(body).length === 1
  ) {
    const a = await prisma.automation.update({
      where: { id: params.id },
      data: { enabled: body.enabled },
    });
    return NextResponse.json(
      automationToDTO(a, (await matchConversations(a)).length)
    );
  }
  const a = await prisma.automation.update({
    where: { id: params.id },
    data: sanitizeAutomationInput(body),
  });
  return NextResponse.json(
    automationToDTO(a, (await matchConversations(a)).length)
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.automation.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
