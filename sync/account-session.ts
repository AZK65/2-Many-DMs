import path from "node:path";
import { createHash } from "node:crypto";
export function accountStoragePath(root: string, name: string, accountId?: string) {
  return path.join(root, accountId ? `${name}_${createHash("sha256").update(accountId).digest("hex").slice(0, 16)}` : name);
}
export function xSessionCookies(auth?: { authToken: string; ct0: string }) {
  if (!auth) return null;
  return [
    { name: "auth_token", value: auth.authToken, domain: ".x.com", path: "/", httpOnly: true, secure: true },
    { name: "ct0", value: auth.ct0, domain: ".x.com", path: "/", secure: true },
  ];
}
