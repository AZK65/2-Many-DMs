import crypto from "node:crypto";

// One-time pairing codes that link the browser extension to a user without
// exposing an open cookie-ingest endpoint. In-memory (single container); for a
// multi-instance deploy move this to the DB/Redis.
type Pair = { userId: string; expires: number };
const store: Map<string, Pair> =
  ((globalThis as Record<string, unknown>).__pairCodes as Map<string, Pair>) ||
  ((globalThis as Record<string, unknown>).__pairCodes = new Map());

const TTL_MS = 10 * 60 * 1000;
// Unambiguous alphabet (no 0/O/1/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createPairCode(userId: string): string {
  // Prune expired entries opportunistically.
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k);

  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  store.set(code, { userId, expires: now + TTL_MS });
  return code;
}

export function consumePairCode(code: string): string | null {
  const entry = store.get(String(code || "").trim().toUpperCase());
  if (!entry || entry.expires < Date.now()) return null;
  store.delete(code.trim().toUpperCase());
  return entry.userId;
}
