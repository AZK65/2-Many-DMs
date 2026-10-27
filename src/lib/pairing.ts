import crypto from "node:crypto";
type Pair = { userId: string; expires: number; busy?: boolean; accountId?: string };
const state = globalThis as typeof globalThis & { __setupPairs?: Map<string, Pair> };
const store = state.__setupPairs ||= new Map<string, Pair>();
export const PAIR_TTL = 10 * 60_000;
const keyOf = (code: string) => code.trim().toUpperCase();
export function createPairCode(userId: string): string {
  for (const [key, value] of store) if (value.expires <= Date.now()) store.delete(key);
  const code = crypto.randomBytes(5).toString("hex").toUpperCase();
  store.set(code, { userId, expires: Date.now() + PAIR_TTL });
  return code;
}
export function pairStatus(code: string, userId?: string) {
  const entry = store.get(keyOf(code));
  return entry && entry.expires > Date.now() && (!userId || userId === entry.userId) ? entry : null;
}
export function claimPairCode(code: string) {
  const entry = pairStatus(code);
  if (!entry || entry.busy || entry.accountId) return null;
  entry.busy = true;
  return entry.userId;
}
export function releasePairCode(code: string) { const entry = pairStatus(code); if (entry) entry.busy = false; }
export function completePairCode(code: string, accountId: string) {
  const entry = pairStatus(code); if (entry) { entry.accountId = accountId; entry.busy = false; }
}
