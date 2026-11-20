import type { Page } from "puppeteer";
import { createHash } from "node:crypto";
import { inspectXChatGate } from "./x-chat-gate";
import { isXChatPin } from "../src/lib/x-unlock-state";

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
  // X keeps unrelated search and hidden inputs mounted around its Chat gate.
  // Never count those as PIN slots or type a credential into them.
  const candidates = await page.$$("pierce/input");
  const inputs = [];
  for (const input of candidates) {
    const eligible = await input.evaluate(el => {
      const field = el as HTMLInputElement;
      const style = getComputedStyle(field);
      return !field.disabled && !field.readOnly && field.getBoundingClientRect().width > 0 &&
        field.getBoundingClientRect().height > 0 && style.visibility !== "hidden" && style.display !== "none" &&
        (field.type === "password" || field.inputMode === "numeric" || /passcode|\bpin\b/i.test(`${field.name} ${field.getAttribute("aria-label") || ""} ${field.placeholder}`));
    });
    if (eligible) inputs.push(input); else await input.dispose();
  }
  if (inputs.length !== 1 && inputs.length !== 4) throw new Error("X PIN fields are not ready");

  // Clear first — a half-finished earlier attempt leaves digits behind.
  for (const input of inputs) {
    await input.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
  }

  if (inputs.length > 1 && inputs.length !== passcode.length) throw new Error("passcode length does not match the gate");
  if (inputs.length > 1) {
    for (let i = 0; i < passcode.length; i++) {
      await inputs[i].click();
      await page.keyboard.type(passcode[i], { delay: 90 });
    }
  } else {
    await inputs[0].click();
    await page.keyboard.type(passcode, { delay: 120 });
  }

  // Digit gates submit on the final digit. Enter would submit a rejected code
  // twice, or hit a control on the newly opened inbox.
  if (inputs.length === 1) await page.keyboard.press("Enter");
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
const rejected = new Set<string>();
const uncertain = new Set<string>();

export function passcodeRejected(): boolean {
  return rejected.size > 0;
}

async function hasExplicitPasscodeError(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const roots: Array<Document | ShadowRoot> = [document];
      for (const root of roots) for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
      const text = roots.flatMap(root => Array.from(root.children)
        .filter(el => !["STYLE", "SCRIPT"].includes(el.tagName))
        .map(el => (el as HTMLElement).innerText || "")).join(" ");
      return /(?:incorrect|wrong|invalid)\s+(?:pin|passcode|code)|(?:pin|passcode|code)\s+(?:is\s+)?(?:incorrect|wrong|invalid)|(?:pin|passcode)\s+(?:does not|doesn't)\s+match/i.test(
        text
      );
    });
  } catch {
    return false;
  }
}

export async function tryUnlock(page: Page, options: { passcode?: string; accountId?: string; explicit?: boolean; timeoutMs?: number } = {}): Promise<UnlockResult> {
  const gate = await inspectXChatGate(page);
  if (gate === "inbox") return "not-locked";
  if (gate !== "locked") return "error";

  const passcode = (options.passcode ?? process.env.X_PASSCODE ?? "").trim();
  if (!passcode) return "no-passcode";
  if (!isXChatPin(passcode)) return "error";
  const key = createHash("sha256").update(`${options.accountId || "default"}:${passcode}`).digest("hex");
  if (rejected.has(key)) return "rejected";
  if (uncertain.has(key) && !options.explicit) return "error";

  try {
    await enterPasscode(page, passcode);
    // XChat can spend well over seven seconds restoring its encrypted inbox.
    // Wait for the actual chat surface, and only call the passcode rejected
    // when X renders an explicit error. A slow unlock must not become a false
    // disconnected state.
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    do {
      await wait(250);
      if (await inspectXChatGate(page) === "inbox") {
        uncertain.delete(key);
        console.log("[x] XChat unlock confirmed by the inbox");
        return "unlocked";
      }
      if (await hasExplicitPasscodeError(page)) {
        rejected.add(key);
        // Never log the passcode itself.
        console.error(
          "[x] XChat passcode rejected — this code will not be retried. Check the code in Connections or recover access in X."
        );
        return "rejected";
      }
    } while (Date.now() < deadline);
    uncertain.add(key);
    console.error("[x] XChat unlock is still pending; not retrying automatically.");
    return "error";
  } catch {
    uncertain.add(key);
    console.error("[x] passcode entry could not be verified; no automatic retry.");
    return "error";
  }
}
