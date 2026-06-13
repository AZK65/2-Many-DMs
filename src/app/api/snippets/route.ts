import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const snippets = await prisma.snippet.findMany({
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(snippets);
}

export async function POST(req: NextRequest) {
  const { title, text, shortcut } = await req.json();
  if (!title?.trim() || !text?.trim()) {
    return NextResponse.json(
      { error: "title and text required" },
      { status: 400 }
    );
  }
  const snippet = await prisma.snippet.create({
    data: {
      title: title.trim(),
      text,
      shortcut:
        typeof shortcut === "string" && shortcut.trim()
          ? shortcut.trim().slice(0, 1).toLowerCase()
          : null,
    },
  });
  return NextResponse.json(snippet);
}
