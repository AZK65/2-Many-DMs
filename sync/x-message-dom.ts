// Executed in XChat's page. Keep self-contained (no closures/imports).
export function readXMessageDom() {
  const root = document.querySelector<HTMLElement>('[data-testid="xchatEmbedRoute"]')?.shadowRoot ?? document;
  const timeline = root.querySelector('[data-testid="dm-conversation-content"]') || root.querySelector('[data-testid="dm-message-list-container"]') || root;
  const list = root.querySelector('[data-testid="dm-message-list"]') || root.querySelector('[data-testid="dm-message-list-container"]');
  const rect = list?.getBoundingClientRect();
  const middle = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const bubbles = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-testid^="message-"]')) {
    const match = element.getAttribute('data-testid')?.match(/^message-([a-f0-9]{8}-[a-f0-9-]{27}|\d{10,})$/i);
    if (match) bubbles.set(match[1], element);
  }
  // Retain compatibility with the older text-only markup.
  for (const text of root.querySelectorAll<HTMLElement>('[data-testid^="message-text-"]')) {
    const id = text.getAttribute('data-testid')!.slice('message-text-'.length);
    if (bubbles.has(id)) continue;
    let bubble = text;
    for (let depth = 0; depth < 4 && bubble.parentElement && bubble.parentElement !== list; depth++) {
      if (bubble.parentElement.querySelectorAll('[data-testid^="message-text-"]').length > 1) break;
      bubble = bubble.parentElement;
    }
    bubbles.set(id, bubble);
  }
  const dateLabels = Array.from(timeline.querySelectorAll('*')).filter((element) => !element.children.length && !element.closest('[data-dm-message-row],[data-testid^="message-"]') && /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?|Today|Yesterday|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*)(?:[, ·]+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM))?$/i.test(element.textContent?.trim() || ''));
  return [...bubbles].map(([id, bubble]) => {
    let textElement = bubble.matches('[data-testid^="message-text-"]') ? bubble : bubble.querySelector<HTMLElement>('[data-testid^="message-text-"]');
    // Emoji-only XChat messages have no message-text test ID. Read the native
    // article's explicitly described content, never the entire row (which also
    // contains sender labels, times, reactions and typing UI).
    if (!textElement) {
      const article = bubble.querySelector('[role="article"][aria-describedby]');
      const contentId = article?.getAttribute('aria-describedby')?.split(/\s+/)[0];
      const described = contentId ? Array.from(bubble.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === contentId) : null;
      if (described && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(described.textContent || '') && !described.querySelector('img,video,audio,a')) textElement = described;
    }
    const attachments: Array<{ type: 'image' | 'video' | 'audio' | 'file'; source: string | null; name?: string; isGif?: boolean; nativeDownload?: boolean }> = [];
    const seen = new Set<string>();
    for (const element of bubble.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLAnchorElement>('img,video,audio,a[download]')) {
      const isLink = element.tagName === 'A';
      const source = isLink ? (element as HTMLAnchorElement).href : (element as HTMLImageElement).currentSrc || element.getAttribute('src') || element.querySelector('source')?.src || '';
      if (!source || seen.has(source)) continue;
      // Avatars, emoji and link-card thumbnails are not DM attachments.
      if (/profile_images|profile_banners|\/emoji\//i.test(source)) continue;
      const link = element.closest('a');
      if (!isLink && link && !link.hasAttribute('download') && link.href !== source) continue;
      if (element.closest('[data-testid*="card"],[data-testid*="tweet"]')) continue;
      const type = isLink ? 'file' : element.tagName === 'VIDEO' ? 'video' : element.tagName === 'AUDIO' ? 'audio' : 'image';
      // Only explicit native GIF evidence qualifies. Muted/looping video alone
      // is not enough: ordinary videos must remain click-to-play in Omni.
      const isGif = /\.gif(?:[?#]|$)/i.test(source) || (type === 'video' && (
        /^https:\/\/video\.twimg\.com\/tweet_video\//i.test(source) ||
        Boolean(element.closest('[data-testid="gif"],[data-testid="dmGif"]')) ||
        /^(?:animated\s+)?gif$/i.test(element.getAttribute('aria-label') || '')
      ));
      attachments.push({ type, source, isGif, name: isLink ? (element.getAttribute('download') || element.textContent?.trim() || 'Attachment') : undefined });
      seen.add(source);
    }
    // XChat's voice player uses Web Audio, not an <audio> element. Its native
    // Download control is the source of the decrypted file; never treat the
    // waveform/duration or the sender avatar as the message itself.
    if (!attachments.length && bubble.querySelector('[data-testid="audio-waveform"]')) {
      attachments.push({ type: 'audio', source: null, name: 'Voice message', nativeDownload: true });
    }
    // Do not silently discard a file whose native download button hasn't
    // exposed a URL yet. Keep an honest unavailable-file placeholder.
    if (!attachments.length) {
      const download = bubble.querySelector<HTMLElement>('button[aria-label*="Download"],button[aria-label*="download"],a[download]');
      if (download) attachments.push({ type: 'file', source: null, name: download.getAttribute('download') || bubble.innerText.match(/[^\n]+\.(?:pdf|docx?|xlsx?|csv|zip|txt|pptx?)/i)?.[0]?.trim() || 'Attachment' });
    }
    const timeElements = [bubble, ...Array.from(bubble.querySelectorAll('time,[datetime],[data-timestamp],[title],[aria-label]'))];
    const dateHints = timeElements.flatMap((element) => [element.getAttribute('datetime'), element.getAttribute('data-timestamp'), element.getAttribute('title'), element.getAttribute('aria-label')]).filter((value): value is string => Boolean(value));
    const timeText = bubble.querySelector('[id$="-time"]')?.textContent?.trim() || (bubble.innerText || '').match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi)?.at(-1);
    const day = dateLabels.filter((label) => Boolean(label.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)?.textContent?.trim();
    const content = textElement || bubble.querySelector('img,video,audio,a[download]') || bubble;
    const bounds = content.getBoundingClientRect();
    const side = bubble.querySelector('[data-side]')?.getAttribute('data-side');
    const direction: 'in' | 'out' = side === 'start' ? 'in' : side === 'end' ? 'out' : bounds.left + bounds.width / 2 > middle ? 'out' : 'in';
    const text = (textElement?.innerText || '').replace(/(\s*\d{1,2}:\d{2}\s*(AM|PM))+\s*$/i, '').trim();
    return { id, direction, text, dateHints, timeText, day, attachments };
  }).filter((row) => row.text || row.attachments.length);
}

// Blob URLs are decrypted by XChat and belong to this exact page. Resolve
// them before scrolling/unmounting the bubble; never persist a blob URL.
export async function readXAttachmentBytes(input: { url: string; maxBytes: number }) {
  const url = new URL(input.url);
  const origin = url.protocol === 'blob:' ? new URL(url.pathname) : url;
  if (!['https:', 'blob:'].includes(url.protocol) || origin.protocol !== 'https:' || !(origin.hostname === 'x.com' || origin.hostname === 'twitter.com' || origin.hostname === 'twimg.com' || origin.hostname.endsWith('.twimg.com') || origin.hostname === 'ton.twitter.com')) throw new Error('Unsupported X attachment source');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(input.url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`X attachment download failed (${response.status})`);
    const length = Number(response.headers.get('content-length'));
    if (length > input.maxBytes) throw new Error('X attachment exceeds the automatic download size limit');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('X attachment has no content');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > input.maxBytes) { await reader.cancel(); throw new Error('X attachment exceeds the automatic download size limit'); }
      chunks.push(part.value);
    }
    if (!size) throw new Error('X attachment is empty');
    let binary = '';
    for (const chunk of chunks) {
      for (let offset = 0; offset < chunk.length; offset += 8192) binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
    }
    return { base64: btoa(binary), mime: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
  } finally { clearTimeout(timeout); }
}
