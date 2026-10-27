/** Only trust server retry dates that are in the future. Headers use seconds. */
export function xRetryDeadline(headers: Record<string, string>, now = Date.now()): number {
  const reset = Number(headers["x-rate-limit-reset"] || 0) * 1000;
  const retry = headers["retry-after"]?.trim();
  const retryAt = retry
    ? /^\d+(?:\.\d+)?$/.test(retry)
      ? now + Number(retry) * 1000
      : Date.parse(retry)
    : 0;
  return Math.max(
    Number.isFinite(reset) && reset > now ? reset : 0,
    Number.isFinite(retryAt) && retryAt > now ? retryAt : 0
  );
}

export function xRateLimitTransition(
  current: { retryAt: number; failures: number },
  serverRetryAt: number,
  now = Date.now(),
  baseMs = 15 * 60 * 1000
): { retryAt: number; failures: number; newStrike: boolean } {
  // Responses from an already-open route may still finish after the first
  // 429. They belong to the same incident, not a new failed recovery attempt.
  if (current.retryAt > now) {
    return {
      retryAt: Math.max(current.retryAt, serverRetryAt),
      failures: current.failures,
      newStrike: false,
    };
  }
  const failures = current.failures + 1;
  const backoff = Math.min(
    6 * 60 * 60 * 1000,
    Math.max(15 * 60 * 1000, baseMs) * 2 ** Math.min(5, failures - 1)
  );
  return { retryAt: Math.max(now + backoff, serverRetryAt), failures, newStrike: true };
}

export function isXRateLimitRelevant(url: string, resourceType: string): boolean {
  if (!["document", "xhr", "fetch"].includes(resourceType)) return false;
  try {
    const parsed = new URL(url);
    if (!["x.com", "api.x.com", "twitter.com", "api.twitter.com"].includes(parsed.hostname)) return false;
    // Analytics and the navigation badge counter have independent quotas.
    // A 429 there must not take otherwise-working DM reads/sends offline.
    // Unknown API operations remain protected by the conservative circuit.
    return !/(?:^|\/)(?:jot|client_event|client-events|metrics)(?:\/|\.|$)/i.test(parsed.pathname) &&
      !/^\/i\/api\/graphql\/[^/]+\/ViewerBadgeCounts\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}
