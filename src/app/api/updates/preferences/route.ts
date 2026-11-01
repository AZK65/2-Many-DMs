import { NextRequest, NextResponse } from "next/server";
import { updatePreferenceStore } from "@/lib/update-preferences";
import { selfUpdateEnabled, updateMutationAllowed, updateUnavailableReason } from "@/lib/update-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const configurable = selfUpdateEnabled(request);
    return NextResponse.json({ ...updatePreferenceStore().read(), configurable, reason: configurable ? null : updateUnavailableReason() });
  } catch { return NextResponse.json({ error: "Could not load update preferences. Auto updates are paused; retry to check your setting." }, { status: 503 }); }
}
export async function PATCH(request: NextRequest) {
  if (!updateMutationAllowed(request)) return NextResponse.json({ error: updateUnavailableReason() }, { status: 403 });
  try {
    const value = updatePreferenceStore().patch(await request.json());
    return NextResponse.json({ ...value, configurable: true, reason: null });
  } catch (error) {
    const invalid = error instanceof SyntaxError || /Invalid update preference/.test(String(error));
    return NextResponse.json({ error: invalid ? "Invalid update preference." : "Could not save update preferences. Your change was not confirmed; please retry." }, { status: invalid ? 400 : 503 });
  }
}
