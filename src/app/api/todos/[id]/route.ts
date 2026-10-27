import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const data: {
    title?: string;
    note?: string | null;
    priority?: boolean;
    completed?: boolean;
    completedAt?: Date | null;
  } = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 200);
  if (body.note === null || typeof body.note === "string") data.note = body.note?.trim().slice(0, 1000) || null;
  if (typeof body.priority === "boolean") data.priority = body.priority;
  if (typeof body.completed === "boolean") {
    data.completed = body.completed;
    data.completedAt = body.completed ? new Date() : null;
  }
  return NextResponse.json(await prisma.todoTask.update({ where: { id: params.id }, data }));
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.todoTask.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
