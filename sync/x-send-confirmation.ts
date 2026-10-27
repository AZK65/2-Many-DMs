export type XSendConfirmation =
  | { kind: "message"; id: string; text: string }
  | { kind: "accepted" }
  | false;

// Composer clearing is only provisional acceptance. Keep observing the same
// open page for its message ID instead of returning before the bubble paints.
// This polls local DOM only: no reloads, extra X requests, or repeat sends.
export async function waitForXSendConfirmation(
  read: () => Promise<XSendConfirmation>,
  timeoutMs: number,
  clock = Date.now,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
): Promise<XSendConfirmation> {
  const deadline = clock() + timeoutMs;
  let accepted = false;
  while (clock() < deadline) {
    const result = await read();
    if (result && result.kind === "message") return result;
    if (result && result.kind === "accepted") accepted = true;
    await pause(150);
  }
  return accepted ? { kind: "accepted" } : false;
}
