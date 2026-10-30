import { NextRequest, NextResponse } from "next/server";
import { currentWorkspaceId, finishWorkspace, openWorkspace, renameWorkspace, removeWorkspace } from "@/lib/workspace-runtime";
import { workspaceDelegate, workspaceDenied, workspaceFailure, workspaceHome, workspaceOwnerRequest } from "@/lib/workspace-api";
import { setupBody } from "@/lib/setup-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!workspaceOwnerRequest(req)) return workspaceDenied();
  try { return await workspaceDelegate(req, `/api/workspaces/${encodeURIComponent(params.id)}`, {}) || NextResponse.json(await openWorkspace(params.id, workspaceHome(req))); }
  catch (error) { return workspaceFailure(error); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!workspaceOwnerRequest(req)) return workspaceDenied();
  const body = await setupBody(req);
  try {
    if (body.action && body.action !== "rename" && body.action !== "finish") throw new Error("Unknown workspace action.");
    return await workspaceDelegate(req, `/api/workspaces/${encodeURIComponent(params.id)}`, body) || NextResponse.json(body.action === "rename" ? await renameWorkspace(params.id, body.name) : await finishWorkspace(params.id));
  }
  catch (error) { return workspaceFailure(error); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!workspaceOwnerRequest(req)) return workspaceDenied();
  if (params.id === currentWorkspaceId() && params.id !== "default") return NextResponse.json({ error: "Switch to the main workspace before removing the workspace you are using." }, { status: 409 });
  const body = await setupBody(req);
  try { return await workspaceDelegate(req, `/api/workspaces/${encodeURIComponent(params.id)}`, body) || NextResponse.json(await removeWorkspace(params.id, body.confirmation)); }
  catch (error) { return workspaceFailure(error); }
}
