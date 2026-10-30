export type WorkspaceSummary = {
  id: string;
  name: string;
  createdAt: string | null;
  setupComplete: boolean;
  state: "ready" | "creating" | "error";
};

export type WorkspaceList = { currentId: string; workspaces: WorkspaceSummary[] };

export function workspaceName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a workspace name.");
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Use a name between 1 and 48 characters.");
  }
  return name;
}

export const workspaceIdValid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
