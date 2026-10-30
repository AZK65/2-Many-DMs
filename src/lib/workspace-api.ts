import { NextRequest, NextResponse } from "next/server";
import { sameSetupOrigin } from "./setup-origin";
import { currentWorkspaceId, isolatedWorkspace } from "./workspace-runtime";

export function workspaceOwnerRequest(req: NextRequest) {
  const host = req.headers.get("host") || new URL(req.url).host;
  try {
    const url = new URL(`http://${host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && sameSetupOrigin(req) && process.env.MARKETING_ONLY !== "1";
  } catch { return false; }
}

export function workspaceHome(req: NextRequest) {
  if (isolatedWorkspace()) return process.env.OMNI_WORKSPACE_HOME_URL!;
  return `http://${req.headers.get("host") || new URL(req.url).host}`;
}

export async function workspaceDelegate(req: NextRequest, pathname: string, body?: object) {
  if (!isolatedWorkspace()) return null;
  const home = new URL(workspaceHome(req));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(home.hostname)) throw new Error("Workspace manager is not configured locally.");
  const result = await fetch(new URL(pathname, home), {
    method: req.method, cache: "no-store", signal: AbortSignal.timeout(110_000),
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
  const data = await result.json();
  if (pathname === "/api/workspaces" && req.method === "GET") data.currentId = currentWorkspaceId();
  return NextResponse.json(data, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
}

export const workspaceDenied = () => NextResponse.json({ error: "Workspaces can only be managed from this computer, not from a public or shared link." }, { status: 403 });
export const workspaceFailure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : "Workspace could not be opened. Your saved data is unchanged." }, { status: 400 });
