import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fs.readFile(path.join(process.cwd(), "public/downloads/omni-dictation-macos.zip"));
    return new NextResponse(data, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="omni-dictation-macos.zip"',
      "Cache-Control": "no-store",
    } });
  } catch {
    return NextResponse.json({ error: "The Mac helper package is not included in this deployment. Build it on a Mac with npm run package:mac and include public/downloads/omni-dictation-macos.zip in the deployment." }, { status: 503 });
  }
}
