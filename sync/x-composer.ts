import type { Page } from "puppeteer";

export const X_COMPOSER_SELECTOR = [
  '[data-testid="dm-composer-textarea"]',
  'textarea[aria-label="Message"]',
  '[data-testid="dm-conversation-panel"] [contenteditable="true"]',
  '[data-testid="dm-conversation-panel"] [role="textbox"]',
  '[data-testid="dmComposerTextInput"]',
].join(",");

/** Activating an unlocked X tab can replace its composer. Focus the current
 * visible input, without a mouse click that can hit a transient overlay. This
 * only prepares the draft: it never presses Send or changes conversations. */
export async function focusXComposer(page: Page, conversationId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    const path = new URL(page.url()).pathname;
    if (path !== `/i/chat/${conversationId}`) {
      throw new Error(/\/i\/chat\/(?:pin|passcode|recovery)/.test(path)
        ? "X Chat is locked. Open Connections > X to unlock it."
        : "X changed conversations before the message was prepared");
    }
    const inputs = await page.$$(`pierce/${X_COMPOSER_SELECTOR}`);
    try {
      for (const input of inputs) {
        try {
          if (!await input.evaluate(el => {
            const field = el as HTMLTextAreaElement;
            const rect = field.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !field.disabled && !field.readOnly && getComputedStyle(field).visibility !== "hidden";
          })) continue;
          await input.focus();
          if (await input.evaluate(el => {
            if (!el.isConnected) return false;
            const root = el.getRootNode();
            return (root instanceof ShadowRoot ? root : document).activeElement === el;
          })) return;
        } catch (error) {
          if (!/detached|not.*element|no element/i.test(String(error))) throw error;
        }
      }
    } finally { await Promise.all(inputs.map(input => input.dispose().catch(() => null))); }
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error("XChat composer did not finish becoming ready");
}
