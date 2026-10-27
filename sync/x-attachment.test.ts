import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { readXAttachmentBytes, readXMessageDom } from './x-message-dom';
import { mergeXHistory } from './x-history';

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
