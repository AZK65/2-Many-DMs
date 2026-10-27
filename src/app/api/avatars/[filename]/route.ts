import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { filename: string } }) {
  if (!/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(params.filename)) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const file = path.join(process.cwd(), "public", "avatars", params.filename);
    const stat = await fs.stat(file);
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const headers = { ETag: etag, "Cache-Control": "private, max-age=300, must-revalidate", "X-Content-Type-Options": "nosniff" };
    if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    const content = await fs.readFile(file);
    const signature = content.toString("ascii", 0, 4);
    const type = content[0] === 0x89 ? "image/png" : signature === "RIFF" ? "image/webp" : signature === "GIF8" ? "image/gif" : "image/jpeg";
    return new NextResponse(content, { headers: { ...headers, "Content-Type": type } });
  } catch {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
