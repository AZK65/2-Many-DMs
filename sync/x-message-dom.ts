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
    const waveform = bubble.querySelector('[data-testid="audio-waveform"]');
    const download = bubble.querySelector<HTMLElement>('button[aria-label*="Download"],button[aria-label*="download"],a[download]');
    // XChat's voice player uses Web Audio, not an <audio> element. Its native
    // Download control is the source of the decrypted file; never let the
    // waveform's decorative SVG get misclassified as an image.
    if (waveform) {
      attachments.push({ type: 'audio', source: null, name: 'Voice message', nativeDownload: true });
    }
    const seen = new Set<string>();
    for (const element of waveform ? [] : bubble.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLAnchorElement>('img,video,audio,a[download]')) {
      const isLink = element.tagName === 'A';
      const source = isLink ? (element as HTMLAnchorElement).href : (element as HTMLImageElement).currentSrc || element.getAttribute('src') || element.querySelector('source')?.src || '';
      if (!source || seen.has(source)) continue;
      // Avatars, emoji and link-card thumbnails are not DM attachments.
      if (/profile_images|profile_banners|\/emoji\//i.test(source)) continue;
      // File cards render their generic document glyph as an inline SVG. The
      // glyph is UI chrome, not the attachment bytes, and used to produce
      // broken "Attachment.svg+xml" messages in Omni.
      if (/^(?:data:image\/svg\+xml|blob:[^#?]+\.svg(?:[?#]|$))|\.svg(?:[?#]|$)/i.test(source)) continue;
      if (!isLink && element.closest('button[aria-label*="Download"],button[aria-label*="download"],a[download]')) continue;
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
      attachments.push({ type, source, isGif, name: isLink ? (element.getAttribute('download') || element.textContent?.trim() || 'Attachment') : undefined,
        // Some X file cards put a blob-backed SVG glyph beside (not inside)
        // the native Download button. Preserve that evidence so the worker
        // can replace the glyph with the real downloaded document.
        nativeDownload: type === 'image' && Boolean(download) ? true : undefined });
      seen.add(source);
    }
    // Do not silently discard a file whose native download button hasn't
    // exposed a URL yet. Recovery clicks this exact row's native control.
    if (!attachments.length && download) {
      const leafText = Array.from(bubble.querySelectorAll<HTMLElement>('*')).filter(element => !element.children.length).map(element => element.textContent?.trim());
      const label = [download.getAttribute('download'), download.getAttribute('aria-label'), download.getAttribute('title'), ...leafText, bubble.innerText]
        .filter(Boolean).join('\n');
      const name = label.match(/[^\n/\\]+\.(?:pdf|docx?|xlsx?|xls|csv|zip|txt|rtf|pptx?|pages|numbers|key)(?=\s|$)/i)?.[0]?.trim() || 'Attachment';
      attachments.push({ type: 'file', source: null, name, nativeDownload: true });
    }
    const timeElements = [bubble, ...Array.from(bubble.querySelectorAll('time,[datetime],[data-timestamp],[title],[aria-label]'))];
    const dateHints = timeElements.flatMap((element) => [element.getAttribute('datetime'), element.getAttribute('data-timestamp'), element.getAttribute('title'), element.getAttribute('aria-label')]).filter((value): value is string => Boolean(value));
    const timeText = bubble.querySelector('[id$="-time"]')?.textContent?.trim() || (bubble.innerText || '').match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi)?.at(-1);
    const day = dateLabels.filter((label) => Boolean(label.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)?.textContent?.trim();
    const content = textElement || bubble.querySelector('img,video,audio,a[download]') || bubble;
    const bounds = content.getBoundingClientRect();
    const side = bubble.querySelector('[data-side]')?.getAttribute('data-side');
    const direction: 'in' | 'out' = side === 'start' ? 'in' : side === 'end' ? 'out' : bounds.left + bounds.width / 2 > middle ? 'out' : 'in';
    // X's message-text wrapper also contains BOTH a hidden timestamp spacer
    // and the visible timestamp/checkmarks. The direction-aware text span is
    // the actual authored body. Never strip clock-looking text from that span.
    const authored = textElement?.querySelector<HTMLElement>('[dir="auto"]');
    const authoredText = (authored?.innerText ?? textElement?.innerText ?? '').trim();
    // Shared posts are rendered as link cards, while X exposes only the
    // generic "Sent a post" label in the message text node. Preserve the
    // canonical status URL so Omni can render and reopen the actual post.
    const postUrl = Array.from(bubble.querySelectorAll<HTMLAnchorElement>('a[href]')).map(anchor => {
      try {
        const url = new URL(anchor.getAttribute('href') || anchor.href, location.origin === 'null' ? 'https://x.com' : location.origin);
        const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
        return (url.hostname === 'x.com' || url.hostname === 'www.x.com' || url.hostname === 'twitter.com' || url.hostname === 'www.twitter.com') && match
          ? `https://x.com/${encodeURIComponent(match[1])}/status/${match[2]}`
          : null;
      } catch { return null; }
    }).find((url): url is string => Boolean(url));
    const text = postUrl && /^(?:sent|shared) (?:a )?post$/i.test(authoredText)
      ? `${authoredText}\n${postUrl}`
      : authoredText || postUrl || '';
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
