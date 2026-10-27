import { createHmac, timingSafeEqual } from "node:crypto";

export const SHARE_COOKIE = "tmd_guest";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function secret(): string {
  return process.env.SHARE_SESSION_SECRET || "";
}

function signature(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createGuestSession(): string {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `guest.${expires}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyGuestSession(value?: string | null): boolean {
  if (!value || !secret()) return false;
  const [role, expiresRaw, supplied] = value.split(".");
  if (role !== "guest" || !expiresRaw || !supplied) return false;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires <= Date.now() / 1000) return false;
  const expected = signature(`${role}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isGuestCookie(value?: string | null): boolean {
  return verifyGuestSession(value);
}

export const SHARE_MAX_AGE = MAX_AGE_SECONDS;
