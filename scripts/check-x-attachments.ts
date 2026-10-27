// Local, isolated browser fixture: no real messages or external requests.
import http from 'node:http';
import { readXMessageDom } from '../sync/x-message-dom';

const html = `<!doctype html><meta charset="utf-8"><title>X attachment regression check</title>
<style>body{font:16px system-ui;background:#f8fafc;color:#172033;padding:24px}#fixture{position:absolute;left:-2000px;width:900px}pre{white-space:pre-wrap}</style>
<h1>X attachment regression check</h1><pre id="results">Running…</pre><div id="fixture" data-testid="xchatEmbedRoute"></div>
<script>
const root=document.getElementById('fixture').attachShadow({mode:'open'});
root.innerHTML='<style>[data-testid="dm-message-list"]{width:900px}article{width:300px}img{width:100px;height:100px}.out{margin-left:550px}</style><section data-testid="dm-conversation-content"><div data-testid="dm-message-list"><p>Today</p>'+
'<article data-testid="message-11111111-1111-4111-8111-111111111111"><img class="photo"><time datetime="2026-10-07T13:00:00Z">9:00 AM</time></article>'+
'<article data-testid="message-22222222-2222-4222-8222-222222222222"><a download="report.pdf" href="blob:https://x.com/document">report.pdf</a><time>9:01 AM</time></article>'+
'<article class="out" data-testid="message-33333333-3333-4333-8333-333333333333"><div data-testid="message-text-33333333-3333-4333-8333-333333333333">Two photos</div><img class="photo"><img class="photo"><time>9:02 AM</time></article>'+
'<article data-testid="message-44444444-4444-4444-8444-444444444444"><div data-testid="message-text-44444444-4444-4444-8444-444444444444">Plain text</div><a href="https://example.invalid"><img src="https://pbs.twimg.com/media/preview.jpg"></a><img src="https://abs.twimg.com/emoji/test.svg"><time>9:03 AM</time></article>'+
'<article data-testid="message-55555555-5555-4555-8555-555555555555"><span>pending.docx</span><button aria-label="Download file">Download</button><time>9:04 AM</time></article>'+
'<p>Today 3:50 PM</p><article data-testid="message-66666666-6666-4666-8666-666666666666"><span hidden>Person</span><div role="article" aria-describedby="emoji-content"><div id="emoji-content"><span>💀</span></div></div><time>3:50 PM</time></article>'+
'<article data-testid="message-77777777-7777-4777-8777-777777777777"><div data-testid="message-text-77777777-7777-4777-8777-777777777777">Yesterday</div><time>3:51 PM</time></article>'+
'<article data-testid="message-88888888-8888-4888-8888-888888888888"><div data-testid="message-text-88888888-8888-4888-8888-888888888888">next message</div></article>'+
'</div></section>';
for(const img of root.querySelectorAll('.photo')) img.src=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'],{type:'image/svg+xml'}));
const read=(${readXMessageDom.toString()});
try{
 const rows=read();
 const checks={
  'photo-only message':rows[0]?.text===''&&rows[0]?.attachments[0]?.type==='image',
  'PDF filename and source':rows[1]?.attachments[0]?.name==='report.pdf'&&rows[1]?.attachments[0]?.source.startsWith('blob:'),
  'caption and multiple photos':rows[2]?.text==='Two photos'&&rows[2]?.attachments.length===2,
  'no avatar/emoji/link preview imports':rows[3]?.attachments.length===0,
  'unavailable file stays visible':rows[4]?.attachments[0]?.name==='pending.docx'&&rows[4]?.attachments[0]?.source===null,
  'native IDs are not duplicated':rows.length===8&&new Set(rows.map(r=>r.id)).size===8,
  'emoji-only native bubble is retained without author or timestamp':rows[5]?.text==='💀'&&rows[5]?.day==='Today 3:50 PM',
  'message text cannot impersonate a date separator':rows[7]?.day==='Today 3:50 PM',
  'source date retained':rows[0]?.dateHints.includes('2026-10-07T13:00:00Z')&&rows[0]?.day==='Today'
 };
 document.getElementById('results').textContent=JSON.stringify({passed:Object.values(checks).every(Boolean),checks},null,2);
}catch(error){document.getElementById('results').textContent=String(error.stack||error)}
</script>`;
http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The fixture only needs local blob images; prevent test URLs contacting X.
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:");
  response.end(html);
}).listen(4317, '127.0.0.1', () => console.log('X attachment fixture: http://127.0.0.1:4317'));
