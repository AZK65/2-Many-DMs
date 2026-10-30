import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentWorkspaceId, isolatedWorkspace, mainWorkspaceName } from "@/lib/workspace-runtime";
import { workspaceDenied, workspaceOwnerRequest } from "@/lib/workspace-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!workspaceOwnerRequest(req)) return workspaceDenied();
  const record = isolatedWorkspace() ? JSON.parse(await readFile(path.join(process.cwd(), "workspace.json"), "utf8")) : null;
  return NextResponse.json({ id: currentWorkspaceId(), name: record?.name || await mainWorkspaceName(), setupComplete: record?.setupComplete ?? true }, { headers: { "Cache-Control": "private, no-store" } });
}
