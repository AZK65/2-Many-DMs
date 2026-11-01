export function selfUpdateEnabled(request: Request) {
  if (process.env.OMNI_WORKSPACE_ID || process.env.ALLOW_SELF_UPDATE === "0") return false;
  const host = request.headers.get("host") || "";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  return process.env.ALLOW_SELF_UPDATE === "1" || local;
}

export function updateMutationAllowed(request: Request) {
  if (!selfUpdateEnabled(request) || request.headers.get("x-omnicrm-update") !== "1") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Local CLI clients still require the explicit header.
  try { return new URL(origin).host === request.headers.get("host"); } catch { return false; }
}

export function updateUnavailableReason() {
  return process.env.OMNI_WORKSPACE_ID
    ? "Updates are managed from the main installation, not an isolated workspace."
    : "One-click updates are disabled on this server. Use manual installation steps.";
}
