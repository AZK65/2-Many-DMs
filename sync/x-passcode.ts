import type { Page } from "puppeteer";

/* XChat (X's encrypted DMs) gates the inbox behind a numeric passcode. On a
   machine with a screen you type it yourself (`npm run x:unlock`); on a headless
   self-hosted box there's no window to type into, so we enter X_PASSCODE
   programmatically here instead.

   Attempts are strictly rationed. X pushes an account into its recovery flow
   after a handful of wrong entries, and the adapter reconnects every 10s — an
   unguarded retry would burn through them in under a minute. Everything goes
   through `tryUnlock`, which refuses to try again once a passcode is rejected. */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOCK_URL_RE = /pin|passcode|recovery/i;

// Is the page sitting on the passcode gate? The URL is the strong signal, but
// some builds render the gate in place without changing it, so fall back to the
// DOM — conservatively, since a chat could contain the word "passcode" itself.
export async function isLocked(page: Page): Promise<boolean> {
  if (LOCK_URL_RE.test(page.url())) return true;
  try {
    return await page.evaluate(() => {
      const root =
        document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
          ?.shadowRoot ?? document;
      // The inbox rendered → we're through the gate, whatever the text says.
      if (root.querySelector('[data-testid="dm-message-list"]')) return false;
      if (!root.querySelector("input")) return false;
      const text =
        root === document
          ? document.body?.innerText || ""
          : root.textContent || "";
      return /passcode/i.test(text.slice(0, 400));
    });
  } catch {
    return false;
  }
}

// Type the passcode and submit. The gate renders one <input> per digit; older
// builds use a single field, so handle both.
async function enterPasscode(page: Page, passcode: string): Promise<void> {
  const inputs = await page.$$("pierce/input");
  if (!inputs.length) throw new Error("no passcode input found on the page");

  // Clear first — a half-finished earlier attempt leaves digits behind.
  for (const input of inputs) {
    await input.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
  }

  if (inputs.length >= passcode.length) {
    for (let i = 0; i < passcode.length; i++) {
      await inputs[i].click();
      await page.keyboard.type(passcode[i], { delay: 90 });
    }
  } else {
    await inputs[0].click();
    await page.keyboard.type(passcode, { delay: 120 });
  }

  await wait(700);
  await page.keyboard.press("Enter");
}

export type UnlockResult =
  | "unlocked"
  | "not-locked"
  | "no-passcode"
  | "rejected"
  | "error";

// Latches once X refuses the passcode, so reconnects stop retrying a wrong code
// and walking the account toward a recovery lockout. Cleared by restarting the
// worker (i.e. after you've fixed X_PASSCODE).
let rejected = false;

export function passcodeRejected(): boolean {
  return rejected;
}

async function hasExplicitPasscodeError(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const root =
        document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')
          ?.shadowRoot ?? document;
      const text = (
        root === document
          ? document.body?.innerText || ""
          : root.textContent || ""
      ).slice(0, 1200);
      return /(?:incorrect|wrong|invalid)\s+(?:pin|passcode)|(?:pin|passcode)\s+(?:incorrect|wrong|invalid)/i.test(
        text
      );
    });
  } catch {
    return false;
  }
}

export async function tryUnlock(page: Page): Promise<UnlockResult> {
  if (!(await isLocked(page))) return "not-locked";

  const passcode = (process.env.X_PASSCODE || "").trim();
  if (!passcode) return "no-passcode";
  if (rejected) return "rejected";

  try {
    await enterPasscode(page, passcode);
    // XChat can spend well over seven seconds restoring its encrypted inbox.
    // Wait for the actual chat surface, and only call the passcode rejected
    // when X renders an explicit error. A slow unlock must not become a false
    // disconnected state.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(1000);
      if (!(await isLocked(page))) {
        console.log("[x] XChat unlocked via X_PASSCODE");
        return "unlocked";
      }
      if (await hasExplicitPasscodeError(page)) {
        rejected = true;
        // Never log the passcode itself.
        console.error(
          "[x] XChat passcode rejected — not retrying, since repeated attempts trigger X's recovery lockout. Fix X_PASSCODE and restart the worker."
        );
        return "rejected";
      }
    }
    console.error("[x] XChat unlock is still pending; not retrying automatically.");
    return "error";
  } catch (e) {
    console.error("[x] passcode entry failed:", e);
    return "error";
  }
}
