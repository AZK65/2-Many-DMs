export const X_UNLOCK_ATTEMPT_MS = 45_000;
export class XUnlockTimeout extends Error {
  constructor() { super("X PIN verification timed out"); this.name = "XUnlockTimeout"; }
}

/** Check both sides of every browser command so an expired attempt cannot
 * continue typing or submit after a delayed CDP response arrives. */
export async function unlockStep<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const result = await action();
  signal?.throwIfAborted();
  return result;
}

/** One budget includes navigation, gate detection, input and confirmation.
 * Retire the page on timeout before releasing ownership to another attempt. */
export async function runXUnlockAttempt<T>(work: (signal: AbortSignal) => Promise<T>, retire: () => Promise<void>, timeoutMs = X_UNLOCK_ATTEMPT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const error = new XUnlockTimeout(); controller.abort(error); reject(error); }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } catch (error) {
    if (controller.signal.aborted) await retire();
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}
