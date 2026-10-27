import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connectorZip } from "@/lib/connector-zip";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const files = await Promise.all(["manifest.json", "popup.html", "popup.js", "README.md"].map(async name => ({ name, data: await readFile(path.join(process.cwd(), "extension", name)) })));
    return new Response(new Uint8Array(connectorZip(files)), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="2manydms-x-connector.zip"', "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "The connector download is unavailable. Use the extension folder in your 2manydms installation." }, { status: 503 }); }
}
