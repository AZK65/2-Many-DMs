import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    await prisma.todoTask.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    })
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "Task title is required" }, { status: 400 });
  const task = await prisma.todoTask.create({
    data: {
      title: title.slice(0, 200),
      note: String(body.note || "").trim().slice(0, 1000) || null,
      priority: body.priority === true,
    },
  });
  return NextResponse.json(task, { status: 201 });
}
