import { NextRequest, NextResponse } from "next/server";
import { calApiKey, deleteCalApiKey, saveCalApiKey, validateCalApiKey } from "@/lib/calcom";
import { clientIp, getCurrentUser } from "@/lib/currentUser";
import { sameSetupOrigin, setupBody } from "@/lib/setup-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(clientIp(req));
  return NextResponse.json({ configured: Boolean(await calApiKey(user.id)), managedByEnvironment: Boolean(process.env.CAL_API_KEY) });
}

export async function POST(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open Settings from Omni to connect Cal.com." }, { status: 403 });
  try {
    const body = await setupBody(req);
    const apiKey = await validateCalApiKey(body.apiKey);
    const user = await getCurrentUser(clientIp(req));
    await saveCalApiKey(user.id, apiKey);
    return NextResponse.json({ configured: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cal.com could not be connected." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameSetupOrigin(req)) return NextResponse.json({ error: "Open Settings from Omni to disconnect Cal.com." }, { status: 403 });
  if (process.env.CAL_API_KEY) return NextResponse.json({ error: "This Cal.com key is managed by the server environment." }, { status: 409 });
  const user = await getCurrentUser(clientIp(req));
  await deleteCalApiKey(user.id);
  return NextResponse.json({ configured: false });
}
