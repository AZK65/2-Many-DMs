import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const COLORS = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#eab308",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#64748b",
];

export async function GET() {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const existing = await prisma.tag.findUnique({ where: { name: trimmed } });
  if (existing) return NextResponse.json(existing);

  const count = await prisma.tag.count();
  const tag = await prisma.tag.create({
    data: { name: trimmed, color: COLORS[count % COLORS.length] },
  });
  return NextResponse.json(tag);
}
