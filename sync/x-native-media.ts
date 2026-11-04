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

const FILE_MIME: Record<string, string> = {
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

export function nativeXFileFormat(bytes: Buffer, suggestedFilename = 'Attachment'): { mime: string; ext: string; name: string } {
  if (!bytes.length) throw new Error('X returned an empty file');
  const clean = path.basename(suggestedFilename).replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'Attachment';
  const suggestedExt = path.extname(clean).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const prefix = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html')) throw new Error('X returned a web page instead of the attached file');
  let ext = suggestedExt;
  let mime = FILE_MIME[ext] || 'application/octet-stream';
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  if (isPdf) { ext = 'pdf'; mime = FILE_MIME.pdf; }
  else if (bytes.subarray(0, 4).toString('hex') === '504b0304') { ext = ['docx', 'xlsx', 'pptx', 'zip'].includes(ext) ? ext : 'zip'; mime = FILE_MIME[ext]; }
  else if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') { ext = 'png'; mime = FILE_MIME.png; }
  else if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') { ext = 'jpg'; mime = FILE_MIME.jpg; }
  if (suggestedExt === 'pdf' && !isPdf) throw new Error('X did not return a valid PDF file');
  if (!ext) ext = 'bin';
  const stem = path.basename(clean, path.extname(clean)) || 'Attachment';
  return { mime, ext, name: `${stem}.${ext}` };
}

async function downloadNativeXMedia(page: Page, id: string, maxBytes: number, kind: 'voice message' | 'file'): Promise<{ bytes: Buffer; suggestedFilename: string }> {
  const row = await page.$(messageSelector(id));
  if (!row) throw new Error(`X ${kind} is no longer visible`);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), kind === 'file' ? 'omni-x-file-' : 'omni-x-voice-'));
  const session = await page.createCDPSession();
  const browserContextId = page.browserContext().id;
  let guid: string | undefined;
  let suggestedFilename = kind === 'file' ? 'Attachment' : 'Voice message';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { frameTree } = await session.send('Page.getFrameTree');
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: directory, eventsEnabled: true, browserContextId });
    const downloaded = new Promise<string>((resolve, reject) => {
      session.on('Browser.downloadWillBegin', event => {
        if (event.frameId !== frameTree.frame.id || !/^[a-f0-9-]+$/i.test(event.guid)) return;
        guid = event.guid;
        suggestedFilename = event.suggestedFilename || suggestedFilename;
        if (!/^(?:blob:https:\/\/x\.com\/|https:\/\/(?:[^/]+\.)?(?:twimg\.com|twitter\.com|x\.com)\/|https:\/\/ton\.twitter\.com\/)/i.test(event.url)) {
          void session.send('Browser.cancelDownload', { guid: event.guid, browserContextId }).catch(() => {});
          reject(new Error(`Unsupported X ${kind} download source`));
        }
      });
      session.on('Browser.downloadProgress', event => {
        if (event.guid !== guid) return;
        if (event.totalBytes > maxBytes || event.receivedBytes > maxBytes) {
          void session.send('Browser.cancelDownload', { guid: event.guid, browserContextId }).catch(() => {});
          reject(new Error(`X ${kind} exceeds the download size limit`));
        } else if (event.state === 'completed') resolve(event.guid);
        else if (event.state === 'canceled') reject(new Error(`X ${kind} download was canceled`));
      });
      timer = setTimeout(() => reject(new Error(`X ${kind} download timed out`)), 20000);
    });
    void downloaded.catch(() => {});
    const content = await row.$('[data-dm-message-focus-target]');
    try { await (content || row).hover(); } finally { await content?.dispose(); }
    const button = await row.waitForSelector('button[aria-label="Download"],button[aria-label="download"]', { timeout: 2500 });
    if (!button) throw new Error(`X has not exposed this ${kind} for download`);
    await button.click();
    const file = path.join(directory, await downloaded);
    const stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw new Error(`Invalid X ${kind} download size`);
    return { bytes: await fs.readFile(file), suggestedFilename };
  } finally {
    if (timer) clearTimeout(timer);
    if (guid) await session.send('Browser.cancelDownload', { guid, browserContextId }).catch(() => {});
    await session.send('Browser.setDownloadBehavior', { behavior: 'default', browserContextId }).catch(() => {});
    await session.detach().catch(() => {});
    await row.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** X exposes voice bytes through its native Download action, not the DOM.
 * Only this exact row's Download button is clicked. Capture only this page's
 * bounded download into an isolated temporary directory, never Downloads. */
export async function downloadNativeXVoice(page: Page, id: string, maxBytes: number): Promise<{ bytes: Buffer; ext: string; mime: string }> {
  const result = await downloadNativeXMedia(page, id, maxBytes, 'voice message');
  return { bytes: result.bytes, ...nativeXAudioFormat(result.bytes) };
}

export async function downloadNativeXFile(page: Page, id: string, maxBytes: number): Promise<{ bytes: Buffer; ext: string; mime: string; name: string }> {
  const result = await downloadNativeXMedia(page, id, maxBytes, 'file');
  return { bytes: result.bytes, ...nativeXFileFormat(result.bytes, result.suggestedFilename) };
}
