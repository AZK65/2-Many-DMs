export type XSendConfirmation =
  | { kind: "message"; id: string; text: string }
  | { kind: "accepted" }
  | false;

// Composer clearing is only provisional acceptance. Allow a short paint grace
// for the native ID, but don't hold the send queue for the full 8–12s timeout.
// The warm-page observer and normal history repair can provide the ID later.
// This polls local DOM only: no reloads, extra X requests, or repeat sends.
export async function waitForXSendConfirmation(
  read: () => Promise<XSendConfirmation>,
  timeoutMs: number,
  clock = Date.now,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
): Promise<XSendConfirmation> {
  const deadline = clock() + timeoutMs;
  let acceptedAt: number | undefined;
  while (clock() < deadline) {
    const result = await read();
    if (result && result.kind === "message") return result;
    if (result && result.kind === "accepted") acceptedAt ??= clock();
    if (acceptedAt !== undefined && clock() - acceptedAt >= 600) return { kind: "accepted" };
    await pause(150);
  }
  return acceptedAt !== undefined ? { kind: "accepted" } : false;
}
