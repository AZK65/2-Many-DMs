// Shared path and header boundary for local and hosted MCP gateways.
export function allowedMcpPath(pathname) {
  if (pathname.includes("%") || pathname.includes("\\")) return false;
  return (
    pathname === "/api/mcp" ||
    pathname === "/mcp/authorize" ||
    ["register", "authorize", "approve", "token", "revoke"].some(
      (action) => pathname === `/api/mcp/oauth/${action}`,
    ) ||
    [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ].includes(pathname) ||
    pathname.startsWith("/_next/static/")
  );
}

export function mcpProxyHeaders(incoming, host) {
  const headers = { host };
  for (const name of ["accept", "accept-encoding", "authorization", "content-type", "content-length", "origin", "user-agent", "mcp-protocol-version", "mcp-session-id", "x-tmd-oauth-consent"]) {
    if (incoming[name] !== undefined) headers[name] = incoming[name];
  }
  return headers;
}

export function mcpRequestTarget(target, origin) {
  // Accept only origin-form targets. Invalid or absolute request URLs must not
  // crash the gateway or choose a different upstream origin.
  if (!target?.startsWith("/") || target.startsWith("//") || target.includes("\\"))
    return null;
  try {
    const url = new URL(target, origin);
    return url.origin === origin && allowedMcpPath(url.pathname) ? url : null;
  } catch {
    return null;
  }
}
