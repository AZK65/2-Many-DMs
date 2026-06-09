import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const folders = await prisma.folder.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(folders.map((f) => ({ id: f.id, name: f.name })));
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const folder = await prisma.folder.create({ data: { name: trimmed } });
  return NextResponse.json({ id: folder.id, name: folder.name });
}
