import { NextResponse } from "next/server";
import { prisma, prismaReady } from "@/lib/db";
import { getCurrentUser } from "@/lib/currentUser";
import { sameSetupOrigin } from "@/lib/setup-origin";

export const runtime = "nodejs";

async function mutate(request: Request, params: { id: string; messageId: string }, action: "edit" | "delete") {
  if (!sameSetupOrigin(request) || request.headers.get("x-omni-message-action") !== "1" || request.headers.get("x-tmd-guest") === "1")
    return NextResponse.json({ error: "Message actions must come from your workspace." }, { status: 403 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input.requestId !== "string" || typeof input.expectedBody !== "string" ||
      !(input.expectedEditedAt === null || typeof input.expectedEditedAt === "string") ||
      (action === "delete" && input.confirmDelete !== true))
    return NextResponse.json({ error: "Confirm the message action first." }, { status: 400 });
  await prismaReady;
  const user = await getCurrentUser();
  const message = await prisma.message.findFirst({ where: { id: params.messageId, conversationId: params.id,
    conversation: { account: { userId: user.id } } }, select: { id: true } });
  if (!message) return NextResponse.json({ error: "Message not found in this workspace." }, { status: 404 });
  try {
    const response = await fetch(`${process.env.SYNC_CONTROL_URL || "http://localhost:4001"}/messages/mutate`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ action, conversationId: params.id, messageId: params.messageId, userId: user.id,
        requestId: input.requestId, expectedBody: input.expectedBody, expectedEditedAt: input.expectedEditedAt, body: input.body }),
    });
    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Could not confirm the action. Check the native app before trying again; no automatic retry will be made." }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string; messageId: string } }) { return mutate(request, params, "edit"); }
export async function DELETE(request: Request, { params }: { params: { id: string; messageId: string } }) { return mutate(request, params, "delete"); }
