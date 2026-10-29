import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JSHandle, Page } from 'puppeteer';

function messageSelector(id: string) {
  if (!/^(?:[a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i.test(id)) throw new Error('Invalid native X message ID');
  return `pierce/[data-testid="message-${id}"]`;
}

/** Read the exact message's Info sheet, not a neighbouring message's time. */
export async function readNativeXMessageTime(page: Page, id: string): Promise<string | null> {
  const row = await page.$(messageSelector(id));
  if (!row) return null;
  let opened = false;
  try {
    // Do not scroll to a row: X virtualizes it while hover() is scrolling and
    // detaches the handle. Expose the actual bubble's native hover controls in
    // place, then re-query the exact native ID before clicking only More.
    await row.evaluate(el => {
      const content = el.querySelector('[data-dm-message-focus-target]') || el;
      content.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      content.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const more = await page.waitForFunction((nativeId) => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot || document;
      return root.querySelector(`[data-testid="message-${nativeId}"] button[aria-label="More"]`);
    }, { timeout: 1800 }, id) as JSHandle<Element | null>;
    try { await more.evaluate(el => (el as HTMLButtonElement).click()); } finally { await more.dispose(); }
    opened = true;
    const info = await page.waitForFunction(() => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot || document;
      return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el => el.textContent?.trim() === 'Info') || null;
    }, { timeout: 1800 }) as JSHandle<HTMLElement | null>;
    try { await info.evaluate(el => (el as HTMLElement).click()); } finally { await info.dispose(); }
    await page.waitForSelector('pierce/[data-testid="dm-message-details-sheet"]', { timeout: 1800, visible: true });
    return await page.evaluate(() => {
      const root = document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot || document;
      const sheet = root.querySelector('[data-testid="dm-message-details-sheet"]');
      const label = Array.from(sheet?.querySelectorAll('*') || []).find(el => !el.children.length && el.textContent?.trim() === 'Sent');
      return label?.nextElementSibling?.textContent?.trim() || null;
    });
  } finally {
    if (opened) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForSelector('pierce/[data-testid="dm-message-details-sheet"]', { hidden: true, timeout: 1800 }).catch(() => {});
    }
    await row.dispose();
  }
}

export function nativeXAudioFormat(bytes: Buffer): { mime: string; ext: string } {
  if (bytes.subarray(4, 8).toString() === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (bytes.subarray(0, 4).toString() === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mime: 'audio/webm', ext: 'webm' };
  throw new Error('X did not return a recognized audio file');
}

/** X exposes voice bytes through its native Download action, not the DOM.
 * Only this exact row's Download button is clicked. Capture only this page's
 * bounded download into an isolated temporary directory, never Downloads. */
export async function downloadNativeXVoice(page: Page, id: string, maxBytes: number): Promise<{ bytes: Buffer; ext: string; mime: string }> {
  const row = await page.$(messageSelector(id));
  if (!row) throw new Error('X voice message is no longer visible');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-x-voice-'));
  const session = await page.createCDPSession();
  const browserContextId = page.browserContext().id;
  let guid: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { frameTree } = await session.send('Page.getFrameTree');
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: directory, eventsEnabled: true, browserContextId });
    const downloaded = new Promise<string>((resolve, reject) => {
      session.on('Browser.downloadWillBegin', event => {
        if (event.frameId !== frameTree.frame.id) return;
        if (!/^[a-f0-9-]+$/i.test(event.guid)) return;
        guid = event.guid;
        if (!/^(?:blob:https:\/\/x\.com\/|https:\/\/(?:[^/]+\.)?(?:twimg\.com|twitter\.com|x\.com)\/)/i.test(event.url)) {
          void session.send('Browser.cancelDownload', { guid: event.guid, browserContextId }).catch(() => {});
          reject(new Error('Unsupported X voice download source'));
        }
      });
      session.on('Browser.downloadProgress', event => {
        if (event.guid !== guid) return;
        if (event.totalBytes > maxBytes || event.receivedBytes > maxBytes) {
          void session.send('Browser.cancelDownload', { guid: event.guid, browserContextId }).catch(() => {});
          reject(new Error('X voice message exceeds the download size limit'));
        } else if (event.state === 'completed') resolve(event.guid);
        else if (event.state === 'canceled') reject(new Error('X voice download was canceled'));
      });
      timer = setTimeout(() => reject(new Error('X voice download timed out')), 20000);
    });
    // Attach a handler immediately, including while the button is appearing.
    void downloaded.catch(() => {});
    const content = await row.$('[data-dm-message-focus-target]');
    try { await (content || row).hover(); } finally { await content?.dispose(); }
    const button = await row.waitForSelector('button[aria-label="Download"]', { timeout: 2500 });
    if (!button) throw new Error('X has not exposed this voice message for download');
    await button.click();
    const file = path.join(directory, await downloaded);
    const stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw new Error('Invalid X voice download size');
    const bytes = await fs.readFile(file);
    return { bytes, ...nativeXAudioFormat(bytes) };
  } finally {
    if (timer) clearTimeout(timer);
    if (guid) await session.send('Browser.cancelDownload', { guid, browserContextId }).catch(() => {});
    await session.send('Browser.setDownloadBehavior', { behavior: 'default', browserContextId }).catch(() => {});
    await session.detach().catch(() => {});
    await row.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
