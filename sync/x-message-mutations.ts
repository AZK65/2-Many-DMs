import type { ElementHandle, Page } from "puppeteer";
import { isNativeXMutationKey, MessageMutationRejected, type MessageMutationAction } from "../src/lib/message-mutations";
import { normalizeXMessageText } from "./x-message-text";
import { scrollXSurface } from "./x-dom-scroll";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pierce = (selector: string) => `pierce/${selector}`;

/** Runs only against the rendered X Chat UI. No private endpoints or guessed
 * IDs. The caller holds the connector's outbound lock throughout verification. */
export async function mutateXMessage(page: Page, input: {
  chat: string; key: string; action: MessageMutationAction; expectedBody: string; body?: string;
}, guard: () => void = () => {}) {
  if (!/^[\w-]{1,150}$/.test(input.chat) || !isNativeXMutationKey(input.key))
    throw new MessageMutationRejected("This message has no verified native X identity. Load its full history first.");
  if (input.action === "edit" && (!input.body?.trim() || input.body.length > 10000))
    throw new MessageMutationRejected("Enter an X message of at most 10,000 characters.");
  const id = input.key.slice(2);
  const rowSelector = `[data-testid="message-${id}"]`;
  let committed = false;
  let editing = false;
  const assertRoute = () => {
    guard();
    const url = new URL(page.url());
    if (url.origin !== "https://x.com" || url.pathname !== `/i/chat/${input.chat}`)
      throw new Error("The native X conversation changed. No other conversation will be used.");
  };
  const read = async () => {
    assertRoute();
    return page.evaluate((nativeId) => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot || document;
      const rows = [...root.querySelectorAll<HTMLElement>('[data-dm-message-row]')];
      const row = root.querySelector<HTMLElement>(`[data-testid="message-${nativeId}"]`);
      const body = row?.querySelector<HTMLElement>(`[data-testid="message-text-${nativeId}"] [dir="auto"]`);
      return {
        found: !!row,
        mine: row?.querySelector('[id$="-sender"]')?.textContent?.trim() === "You" && row?.getAttribute("data-send-status") === "sent",
        body: body?.innerText ?? null,
        ids: rows.map(el => el.getAttribute('data-dm-message-row')!),
        editing: !!root.querySelector('[data-testid="dm-composer-discard-edit-button"]'),
        ready: !!root.querySelector('[data-testid="dm-composer-textarea"]') && !!root.querySelector('[data-testid="dm-message-list"],[data-testid="dm-message-list-container"]'),
      };
    }, id);
  };
  const locate = async (predicate: (state: Awaited<ReturnType<typeof read>>) => boolean) => {
    // Bounded history traversal; never select a similar body or neighbouring ID.
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await read();
      if (predicate(state)) return state;
      if (attempt > 1) await page.evaluate(scrollXSurface, { kind: "messages", direction: "older" } as const);
      await pause(500);
    }
    return read();
  };
  const exactMenuItem = async (label: string): Promise<ElementHandle<HTMLElement>> => {
    const handle = await page.evaluateHandle((text) => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot || document;
      const matches = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(el =>
        el.textContent?.trim() === text && el.getBoundingClientRect().width > 0 && el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('data-disabled'));
      return matches.length === 1 ? matches[0] : null;
    }, label);
    const element = handle.asElement() as ElementHandle<HTMLElement> | null;
    if (!element) { await handle.dispose(); throw new MessageMutationRejected(`X does not offer ${label} for this message. Nothing was changed.`); }
    return element;
  };
  try {
    await page.bringToFront();
    const initial = await locate(state => state.found);
    if (!initial.found || !initial.mine) throw new MessageMutationRejected("X could not verify this exact message as sent by your connected account. Nothing was changed.");
    if (initial.editing) throw new MessageMutationRejected("An X edit is already open. Finish it in X first.");
    if ((input.action === "edit" || initial.body !== null) &&
        normalizeXMessageText(initial.body || "") !== normalizeXMessageText(input.expectedBody))
      throw new MessageMutationRejected("The message text in X differs from this copy. Refresh its history before changing it.");
    const index = initial.ids.indexOf(id);
    const neighbors = [initial.ids[index - 1], initial.ids[index + 1]].filter(Boolean);
    if (input.action === "delete" && !neighbors.length)
      throw new MessageMutationRejected("X has not loaded enough surrounding history to verify deletion safely. Open the message in X or load more history first.");

    const draft = await page.$eval(pierce('[data-testid="dm-composer-textarea"]'), el => (el as HTMLTextAreaElement).value);
    if (draft.trim()) throw new MessageMutationRejected("There is an unsent draft in this X chat. Send or clear it in X first; it will not be overwritten.");
    await page.keyboard.press("Escape");
    const row = await page.$(pierce(rowSelector));
    if (!row) throw new MessageMutationRejected("X moved this message out of view. Nothing was changed.");
    try {
      await row.evaluate(el => {
        const target = el.querySelector('[data-dm-message-focus-target]') || el;
        target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
    } finally { await row.dispose(); }
    const more = await page.waitForSelector(pierce(`${rowSelector} button[aria-label="More"]`), { timeout: 2500 });
    if (!more) throw new MessageMutationRejected("X did not expose this message’s controls.");
    try { await more.click(); } finally { await more.dispose(); }
    await page.waitForSelector(pierce('[role="menuitem"]'), { timeout: 2500 });
    const action = await exactMenuItem(input.action === "edit" ? "Edit message" : "Delete for all");
    try {
      const target = await read();
      if (!target.found || !target.mine) throw new MessageMutationRejected("The message changed before the action. Nothing was changed.");
      if (target.body !== initial.body) throw new MessageMutationRejected("The text changed in X before the action. Refresh this message first.");
      if (input.action === "delete") committed = true; // Some X versions delete immediately.
      await action.click();
    } finally { await action.dispose(); }

    if (input.action === "edit") {
      editing = true;
      await page.waitForSelector(pierce('[data-testid="dm-composer-discard-edit-button"]'), { visible: true, timeout: 3000 });
      const selector = pierce('[data-testid="dm-composer-textarea"]');
      const current = await page.$eval(selector, el => (el as HTMLTextAreaElement).value);
      if (normalizeXMessageText(current) !== normalizeXMessageText(input.expectedBody))
        throw new MessageMutationRejected("X opened a different or newer edit. Nothing was saved.");
      await page.click(selector);
      await page.$eval(selector, (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (!setter) throw new Error("X editor is unavailable.");
        setter.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, input.body!);
      const prepared = await page.$eval(selector, el => (el as HTMLTextAreaElement).value);
      if (prepared !== input.body) throw new MessageMutationRejected("X did not accept the exact edit text. Nothing was saved.");
      assertRoute();
      // Save must still be an edit. Never accidentally click the Send action.
      const save = await page.$(pierce('[data-testid="dm-composer-send-button"][aria-label="Save"]:not([disabled])'));
      const beforeSave = await read();
      if (!save || !beforeSave.editing || !beforeSave.mine || beforeSave.body !== initial.body) {
        await save?.dispose(); throw new MessageMutationRejected("X no longer offers Save for this exact edit. Nothing was sent.");
      }
      committed = true;
      try { await save.click(); } finally { await save.dispose(); }
    } else {
      // Only accept an explicit everyone/all confirmation. Never a generic
      // conversation deletion, Delete for me, or an unrelated dialog.
      for (let attempt = 0; attempt < 12; attempt++) {
        const state = await read();
        if (!state.found) break;
        const confirmation = await page.evaluateHandle(() => {
          const root = document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot || document;
          const dialogs = [...root.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')].filter(el => el.getBoundingClientRect().width > 0);
          if (dialogs.length !== 1 || !/delete[\s\S]{0,40}(?:for all|for everyone)/i.test(dialogs[0].innerText) || /delete conversation/i.test(dialogs[0].innerText)) return null;
          const buttons = [...dialogs[0].querySelectorAll<HTMLButtonElement>('button')].filter(el => /^(?:Delete|Delete for all|Delete for everyone)$/i.test(el.textContent?.trim() || el.getAttribute('aria-label') || '') && !el.disabled);
          return buttons.length === 1 ? buttons[0] : null;
        });
        try { const button = confirmation.asElement() as ElementHandle<HTMLButtonElement> | null; if (button) { assertRoute(); await button.click(); break; } }
        finally { await confirmation.dispose(); }
        await pause(150);
      }
    }
    // First wait for the UI acknowledgement, then reload to reject optimistic
    // success. A missing virtual row alone is never proof of remote deletion.
    const deadline = Date.now() + 8000;
    let acknowledged = false;
    while (Date.now() < deadline) {
      const state = await read();
      acknowledged = input.action === "edit"
        ? !state.editing && state.body?.trim() === input.body!.trim()
        : !state.found && neighbors.every(neighbor => state.ids.includes(neighbor));
      if (acknowledged) break;
      await pause(200);
    }
    if (!acknowledged) throw new Error("X did not acknowledge this message action.");
    assertRoute();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
    const verified = await locate(state => state.ready && (input.action === "edit" ? state.found : neighbors.every(neighbor => state.ids.includes(neighbor))));
    if (!verified.ready || (input.action === "edit"
      ? !verified.found || !verified.mine || verified.body?.trim() !== input.body!.trim()
      : verified.found || !neighbors.every(neighbor => verified.ids.includes(neighbor))))
      throw new Error("X could not confirm the saved result after reloading. Check the native chat.");
  } catch (error) {
    if (!committed) throw new MessageMutationRejected(error instanceof Error ? error.message : "X could not prepare this action. Nothing was changed.");
    throw error instanceof MessageMutationRejected ? new Error(error.message) : error;
  } finally {
    // Do not leave an edit draft in the connector where the next Send could
    // accidentally save it. Closing never submits, even after a timeout.
    if (editing) {
      const cancel = await page.$(pierce('[data-testid="dm-composer-discard-edit-button"]')).catch(() => null);
      try { await cancel?.click(); } catch {} finally { await cancel?.dispose(); }
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
}

