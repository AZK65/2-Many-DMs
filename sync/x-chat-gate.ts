import type { Page } from "puppeteer";
import { unlockStep } from "./x-unlock-attempt";

export type XChatGate = "inbox" | "locked" | "login" | "loading";

/** A finished navigation is not proof that the encrypted inbox has rendered. */
export async function inspectXChatGate(page: Page): Promise<XChatGate> {
  if (/\/login|\/i\/flow\//.test(page.url())) return "login";
  if (/\/i\/chat\/(?:pin|passcode|recovery)(?:\/|\?|$)/i.test(page.url())) return "locked";
  return page.evaluate(() => {
    const roots: Array<Document | ShadowRoot> = [document];
    for (const root of roots) for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const root of roots) {
      if (root.querySelector('[data-testid="dm-conversation-scroller"], [data-testid="dm-message-requests-scroller"], [data-testid="dm-message-list"]')) return "inbox" as const;
    }
    for (const root of roots) {
      const text = Array.from(root.children).filter(el => !["STYLE", "SCRIPT"].includes(el.tagName))
        .map(el => (el as HTMLElement).innerText || "").join(" ");
      if (root.querySelector("input") && /passcode/i.test(text)) return "locked" as const;
    }
    return "loading" as const;
  });
}

export async function waitForXChatGate(page: Page, timeoutMs = 20_000, signal?: AbortSignal): Promise<XChatGate> {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await unlockStep(signal, () => inspectXChatGate(page).catch(() => "loading" as const));
    if (state !== "loading") return state;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (!page.isClosed() && Date.now() < deadline);
  return "loading";
}
