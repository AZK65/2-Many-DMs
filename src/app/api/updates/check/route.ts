import { NextRequest, NextResponse } from "next/server";
import { inspectGitUpdates } from "@/lib/git-updates";
import { selfUpdateEnabled } from "@/lib/update-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Git is the source of truth. Each installation fetches through its own
// configured remote, so private-repository credentials never pass through the
// browser or a public changelog endpoint.
export async function GET(req: NextRequest) {
  try {
    const update = await inspectGitUpdates(true);
    return NextResponse.json({
      ...update,
      selfUpdate: selfUpdateEnabled(req),
      manualCommands: [
        `git fetch ${update.remote}`,
        `git merge --ff-only ${update.targetRef}`,
        "npm install",
        "npx prisma generate",
        "npx prisma db push --skip-generate",
        "npm run build",
      ],
    });
  } catch (error) {
    console.error("[updates] Git update check failed", error);
    return NextResponse.json({
      current: "unknown",
      latest: "unknown",
      currentSha: null,
      latestSha: null,
      hasUpdate: false,
      behindCount: 0,
      aheadCount: 0,
      dirty: false,
      canApply: false,
      blockedReason: null,
      entries: [],
      selfUpdate: false,
      checkedAt: new Date().toISOString(),
      error:
        "Update check could not reach the configured Git remote. Confirm this device still has access to the private repository.",
    });
  }
}
