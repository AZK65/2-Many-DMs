import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, currentWorkspaceId, listWorkspaces } from "@/lib/workspace-runtime";
import { workspaceDelegate, workspaceDenied, workspaceFailure, workspaceHome, workspaceOwnerRequest } from "@/lib/workspace-api";
import { setupBody } from "@/lib/setup-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!workspaceOwnerRequest(req)) return workspaceDenied();
  try { return await workspaceDelegate(req, "/api/workspaces") || NextResponse.json({ currentId: currentWorkspaceId(), workspaces: await listWorkspaces() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return workspaceFailure(error); }
}

export async function POST(req: NextRequest) {
  if (!workspaceOwnerRequest(req)) return workspaceDenied();
  const body = await setupBody(req);
  try { return await workspaceDelegate(req, "/api/workspaces", body) || NextResponse.json(await createWorkspace(body.name, body.requestId, workspaceHome(req))); }
  catch (error) { return workspaceFailure(error); }
}
