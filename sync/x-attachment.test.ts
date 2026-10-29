import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { readXAttachmentBytes, readXMessageDom } from './x-message-dom';
import { mergeXHistory } from './x-history';
import { parseXMessageInfoDate, xHistoryMatchesPreview } from './x-history';
import { downloadNativeXVoice, nativeXAudioFormat, readNativeXMessageTime } from './x-native-media';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

test('X attachment readers serialize without external runtime helpers', () => {
  assert.ok(!readXMessageDom.toString().includes('__name'));
  assert.ok(!readXAttachmentBytes.toString().includes('__name'));
});

test('X only labels video GIFs with explicit native evidence', () => {
  const read = (source: string, label = '') => {
    const video = { tagName: 'VIDEO', currentSrc: source, loop: true, muted: true,
      getAttribute: (key: string) => key === 'aria-label' ? label : null,
      closest: () => null, getBoundingClientRect: () => ({ left: 0, width: 100 }) };
    const bubble = { innerText: '', matches: () => false,
      getAttribute: (key: string) => key === 'data-testid' ? 'message-123456789012' : null,
      querySelector: (selector: string) => selector === 'img,video,audio,a[download]' ? video : null,
      querySelectorAll: (selector: string) => selector === 'img,video,audio,a[download]' ? [video] : [],
    };
    const document = { querySelector: () => null,
      querySelectorAll: (selector: string) => selector === '[data-testid^="message-"]' ? [bubble] : [],
    };
    const evaluate = runInNewContext(`(${readXMessageDom.toString()})`, { document, window: { innerWidth: 1000 } });
    return evaluate()[0].attachments[0];
  };
  assert.equal(read('https://video.twimg.com/tweet_video/example.mp4').isGif, true);
  assert.equal(read('blob:https://x.com/animation', 'GIF').isGif, true);
  assert.equal(read('blob:https://x.com/normal-video').isGif, false, 'muted looping video alone is not proof');
  assert.equal(read('https://video.twimg.com/ext_tw_video/example.mp4').isGif, false);
});

test('decrypted X blobs are copied as bytes, not stored as temporary URLs', async () => {
  let calls = 0;
  const read = runInNewContext(`(${readXAttachmentBytes.toString()})`, {
    URL, AbortController, setTimeout, clearTimeout, btoa,
    fetch: async () => { calls++; return new Response('%PDF-test', { headers: { 'content-type': 'application/pdf' } }); },
  });
  const result = await read({ url: 'blob:https://x.com/test', maxBytes: 100 });
  assert.equal(result.mime, 'application/pdf');
  assert.equal(Buffer.from(result.base64, 'base64').toString(), '%PDF-test');
  assert.equal(calls, 1);
  await assert.rejects(read({ url: 'http://127.0.0.1/private', maxBytes: 100 }), /Unsupported/);
  await assert.rejects(read({ url: 'https://unrelated.example/track', maxBytes: 100 }), /Unsupported/);
  await assert.rejects(read({ url: 'data:text/plain,test', maxBytes: 100 }), /Unsupported/);
  assert.equal(calls, 1, 'untrusted URLs must not be fetched');
});

test('X attachment limits apply even without a content-length header', async () => {
  const read = runInNewContext(`(${readXAttachmentBytes.toString()})`, {
    URL, AbortController, setTimeout, clearTimeout, btoa,
    fetch: async () => new Response('too-large-for-test'),
  });
  await assert.rejects(read({ url: 'blob:https://x.com/test', maxBytes: 3 }), /size limit/);
});

test('later history windows retain downloaded attachments and the native message date', () => {
  const base = { id: 'same', direction: 'in' as const, text: '', timestamp: 123 };
  const rows = mergeXHistory([
    [{ ...base, attachments: [{ url: '/media/photo.png' }] }],
    [{ ...base, timestamp: null, attachments: [{ url: null }] }],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timestamp, 123);
  assert.equal(rows[0].attachments?.[0].url, '/media/photo.png');
});

test('native X waveform is an audio attachment even without an audio element', () => {
  const bubble = { innerText: '0:10', matches: () => false,
    getAttribute: (key: string) => key === 'data-testid' ? 'message-3fcf22eb-5eed-4608-a8b6-4269af5b65e1' : null,
    querySelector: (selector: string) => selector === '[data-testid="audio-waveform"]' ? {}
      : selector === '[id$="-time"]' ? { textContent: '3:30 PM' }
      : selector === '[data-side]' ? { getAttribute: () => 'start' } : null,
    querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 900, width: 100 }),
  };
  const document = { querySelector: () => null,
    querySelectorAll: (selector: string) => selector === '[data-testid^="message-"]' ? [bubble] : [],
  };
  const rows = runInNewContext(`(${readXMessageDom.toString()})`, { document, window: { innerWidth: 1000 } })();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timeText, '3:30 PM', 'hidden accessible timestamp is retained');
  assert.equal(rows[0].direction, 'in', 'native data-side wins over width-dependent guesses');
  assert.equal(rows[0].text, '');
  assert.equal(rows[0].attachments[0].type, 'audio');
  assert.equal(rows[0].attachments[0].nativeDownload, true);
  assert.equal(rows[0].attachments[0].source, null);
});

test('X Info dates do not reuse a neighbouring timestamp or redatetime old media', () => {
  const now = new Date(2026, 9, 29, 14).getTime();
  assert.equal(parseXMessageInfoDate('12:52 PM', now), new Date(2026, 9, 29, 12, 52).getTime());
  assert.equal(parseXMessageInfoDate('Oct 15 at 3:30 PM', now), new Date(2026, 9, 15, 15, 30).getTime());
  assert.equal(parseXMessageInfoDate('Sent Yesterday at 3:30 PM', now), new Date(2026, 9, 28, 15, 30).getTime());
  assert.equal(parseXMessageInfoDate('Not available', now), null);
  assert.equal(parseXMessageInfoDate('11:00 PM', now), null, 'future times are rejected');
});

test('X repair recognizes multi-photo and voice-note inbox previews', () => {
  const base = { id: 'native', text: '', direction: 'in' as const, timestamp: 1000 };
  assert.equal(xHistoryMatchesPreview([{ ...base, attachments: [{ type: 'image', url: '/media/a.jpg' }] }], { preview: 'Sent 4 photos', direction: 'in', timestamp: 1000 }), false);
  assert.equal(xHistoryMatchesPreview([{ ...base, attachments: Array.from({length:4}, (_, i) => ({ type: 'image', url: `/media/${i}.jpg` })) }], { preview: 'Sent 4 photos', direction: 'in', timestamp: 1000 }), true);
  assert.equal(xHistoryMatchesPreview([{ ...base, attachments: [{ type: 'audio', url: '/media/a.m4a' }] }], { preview: 'Sent a voice message', direction: 'in', timestamp: 1000 }), true);
});

test('voice format is verified from bytes, not an untrusted filename', () => {
  assert.equal(nativeXAudioFormat(Buffer.from('0000ftypM4A ')).ext, 'm4a');
  assert.equal(nativeXAudioFormat(Buffer.from('OggS0000000')).ext, 'ogg');
  assert.throws(() => nativeXAudioFormat(Buffer.from('<html>login</html>')), /recognized audio/);
});

test('native Info reads the exact row without scrolling virtualized message handles', async () => {
  const events: string[] = [];
  const nativeId = '4fe69963-037d-4723-8abd-74773a204e58';
  const content = { dispatchEvent: (event: { type: string }) => { events.push(event.type); } };
  const more = { click: () => { events.push('More'); } };
  const info = { textContent: 'Info', click: () => { events.push('Info'); } };
  const sent = { children: [], textContent: 'Sent', nextElementSibling: { textContent: '12:52 PM' } };
  const root = {
    querySelector: (selector: string) => {
      if (selector === `[data-testid="message-${nativeId}"] button[aria-label="More"]`) return more;
      if (selector === '[data-testid="dm-message-details-sheet"]') return { querySelectorAll: () => [sent] };
      throw new Error(`Unexpected selector ${selector}`);
    },
    querySelectorAll: () => [info],
  };
  const document = { querySelector: () => ({ shadowRoot: root }) };
  const evaluate = (fn: Function, arg?: any) => runInNewContext(`(${fn.toString()})(arg)`, {
    document, arg, PointerEvent: class { constructor(public type: string) {} }, MouseEvent: class { constructor(public type: string) {} },
  });
  const page = {
    $: async (selector: string) => {
      assert.equal(selector, `pierce/[data-testid="message-${nativeId}"]`);
      return { evaluate: (fn: Function) => evaluate(fn, { querySelector: () => content }), dispose: async () => {} };
    },
    waitForFunction: async (fn: Function, _options: any, arg: any) => {
      const el = evaluate(fn, arg);
      assert.ok(el);
      return { evaluate: (callback: Function) => evaluate(callback, el), dispose: async () => {} };
    },
    waitForSelector: async () => null,
    evaluate: (fn: Function) => evaluate(fn),
    keyboard: { press: async (key: string) => { events.push(key); } },
  };
  assert.equal(await readNativeXMessageTime(page as any, nativeId), '12:52 PM');
  assert.deepEqual(events, ['pointerover', 'mouseover', 'More', 'Info', 'Escape']);
});

test('native voice capture only clicks the scoped Download button and cleans temporary data', async () => {
  const session = new EventEmitter() as EventEmitter & { send: (name: string, input?: any) => Promise<any>; detach: () => Promise<void> };
  let directory = '', restored = false;
  const guid = '12345678-1234-1234-1234-123456789abc';
  session.send = async (name, input) => {
    if (name === 'Page.getFrameTree') return { frameTree: { frame: { id: 'ours' } } };
    if (name === 'Browser.setDownloadBehavior' && input.behavior === 'allowAndName') directory = input.downloadPath;
    if (name === 'Browser.setDownloadBehavior' && input.behavior === 'default') restored = true;
    return {};
  };
  session.detach = async () => {};
  const page = {
    $: async (selector: string) => {
      assert.match(selector, /message-3fcf22eb-5eed-4608-a8b6-4269af5b65e1/);
      return { $: async () => ({ hover: async () => {}, dispose: async () => {} }), hover: async () => { throw new Error('Do not hover the empty row center'); }, dispose: async () => {}, waitForSelector: async (selector: string) => {
        assert.equal(selector, 'button[aria-label="Download"]');
        return { click: async () => {
          session.emit('Browser.downloadWillBegin', { frameId: 'other', url: 'blob:https://x.com/other', guid: 'other' });
          session.emit('Browser.downloadProgress', { guid: 'other', state: 'completed', totalBytes: 10, receivedBytes: 10 });
          session.emit('Browser.downloadWillBegin', { frameId: 'ours', url: 'blob:https://x.com/voice', guid });
          await fs.writeFile(path.join(directory, guid), '0000ftypM4A ');
          session.emit('Browser.downloadProgress', { guid, state: 'completed', totalBytes: 12, receivedBytes: 12 });
        } };
      } };
    }, createCDPSession: async () => session, browserContext: () => ({ id: undefined }),
  };
  const result = await downloadNativeXVoice(page as any, '3fcf22eb-5eed-4608-a8b6-4269af5b65e1', 100);
  assert.equal(result.mime, 'audio/mp4');
  assert.equal(restored, true);
  await assert.rejects(fs.stat(directory));
});
