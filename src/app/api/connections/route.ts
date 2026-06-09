import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const controlUrl = process.env.SYNC_CONTROL_URL || "http://localhost:4001";
  try {
    const res = await fetch(`${controlUrl}/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const platforms = await res.json();
    return NextResponse.json({ workerRunning: true, platforms });
  } catch {
    // Worker not running — report every platform as offline.
    return NextResponse.json({
      workerRunning: false,
      platforms: {
        telegram: { platform: "telegram", state: "disabled" },
        whatsapp: { platform: "whatsapp", state: "disabled" },
        x: { platform: "x", state: "disabled" },
      },
    });
  }
}
