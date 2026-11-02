import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { proto } from "@whiskeysockets/baileys";
import { MAX_BYTES, MEDIA_DIR, saveMediaStream } from "./media";
import { DurableRecords } from "./retention";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";
import { downloadWhatsAppMedia, whatsappMediaContent, WhatsAppMediaLimitError, WhatsAppMediaRecoveryQueue, WHATSAPP_RECOVERY_MAX_BYTES } from "./whatsapp-media-download";

function message(kind = "documentMessage", size = 40 * 1024 * 1024): any {
  return {key:{id:"TEST",remoteJid:"123@s.whatsapp.net",fromMe:false},messageTimestamp:1793617200,
    message:{[kind]:{fileLength:size,mediaKey:Buffer.alloc(32),directPath:"/fixture",mimetype:"application/pdf",fileName:"fixture.pdf"}}};
}
function deps(overrides: Partial<Parameters<typeof downloadWhatsAppMedia>[1]> = {}): Parameters<typeof downloadWhatsAppMedia>[1] {
  return {automatic:false,download:async()=>Readable.from([Buffer.from("fixture")]),
    refresh:async()=>{assert.fail("unexpected refresh");},remember:()=>{},
    save:async(stream)=>{for await (const _ of stream) { /* consume to exercise stream errors */ }return "/media/fixture.pdf";},...overrides};
}

for (const kind of ["documentMessage","imageMessage","videoMessage","audioMessage","stickerMessage"]) {
  test(`${kind}: manual recovery accepts files above the background limit`, async()=>{
    let budget=0;
    const result=await downloadWhatsAppMedia(message(kind),deps({save:async(stream,_media,max)=>{budget=max;stream.destroy();return "/media/fixture";}}));
    assert.equal(result.url,"/media/fixture");
    assert.equal(budget,WHATSAPP_RECOVERY_MAX_BYTES);
    assert.ok(budget>MAX_BYTES);
  });
}

test("automatic and manual oversize errors are truthful and never trigger CDN or phone calls", async()=>{
  const noNetwork=deps({download:async()=>{assert.fail("over-limit file downloaded");}});
  await assert.rejects(downloadWhatsAppMedia(message(),{...noNetwork,automatic:true}), /automatic download limit.*manually/);
  await assert.rejects(downloadWhatsAppMedia(message("documentMessage",WHATSAPP_RECOVERY_MAX_BYTES+1),noNetwork), /download limit.*WhatsApp/);
});

for(const status of [403,404,410]) for(const wrapped of [false,true]) {
  test(`stale link ${status} (${wrapped?"protocol":"HTTP"}) is refreshed once and retained`,async()=>{
    let downloads=0,refreshes=0;const saved:any[]=[];const original=message();
    const fresh=message();fresh.message.documentMessage.directPath="/renewed-fixture";
    const result=await downloadWhatsAppMedia(original,deps({
      download:async m=>{if(++downloads===1)throw wrapped?{output:{statusCode:status}}:{response:{status}};assert.equal(m,fresh);return Readable.from(["ok"]);},
      refresh:async m=>{assert.equal(m,original);refreshes++;return fresh;},remember:m=>saved.push(m),
    }));
    assert.equal(result.url,"/media/fixture.pdf");assert.equal(downloads,2);assert.equal(refreshes,1);assert.deepEqual(saved,[fresh]);
  });
}

test("a stream failure after HTTP setup participates in the same bounded refresh",async()=>{
  let attempts=0,refreshes=0;
  await downloadWhatsAppMedia(message(),deps({download:async()=>++attempts===1
    ? Readable.from((async function*(){yield "partial";throw {output:{statusCode:410}};})()) : Readable.from(["complete"]),
    refresh:async m=>{refreshes++;return m;}}));
  assert.equal(attempts,2);assert.equal(refreshes,1);
});

test("unavailable media gets actionable guidance without an infinite refresh loop",async()=>{
  let refreshes=0;
  await assert.rejects(downloadWhatsAppMedia(message(),deps({download:async()=>{throw {response:{status:404}};},refresh:async m=>{refreshes++;return m;}})), /phone.*sender to resend/);
  assert.equal(refreshes,1);
});

test("refreshed messages must keep the exact identity, even if the native object is mutated",async()=>{
  let saved=0;
  await assert.rejects(downloadWhatsAppMedia(message(),deps({download:async()=>{throw {response:{status:410}};},
    refresh:async m=>{m.key.remoteJid="999@g.us";return m;},remember:()=>{saved++;}})));
  assert.equal(saved,0);
});

for(const code of ["ETIMEDOUT","ECONNRESET","ENOSPC","EACCES","ERR_FIXTURE"]) {
  test(`preserves an actionable ${code} failure without leaking signed URLs`,async()=>{
    await assert.rejects(downloadWhatsAppMedia(message(),deps({download:async()=>{throw Object.assign(new Error("https://secret.example/media?key=fixture"),{code});}})), e=>{
      assert.ok(e instanceof Error);assert.ok(!e.message.includes("expired"));assert.ok(!e.message.includes("secret.example"));
      assert.match(e.message,code==="ENOSPC"||code==="EACCES"?/disk space/:code==="ERR_FIXTURE"?/phone/:/interrupted/);return true;
    });
  });
}

test("a stalled stream is cancelled and the recovery lock can finish",async()=>{
  const stream=new Readable({read(){}});
  await assert.rejects(downloadWhatsAppMedia(message(),deps({download:async()=>stream,timeoutMs:10})),/interrupted/);
  assert.equal(stream.destroyed,true);
});

test("document wrappers, voice notes and GIF flags retain their native metadata",async()=>{
  const raw=message();raw.message={documentWithCaptionMessage:{message:raw.message}};
  assert.equal(whatsappMediaContent(raw).type,"file");
  const gif=message("videoMessage");gif.message.videoMessage.gifPlayback=true;
  assert.equal((await downloadWhatsAppMedia(gif,deps())).isGif,true);
  assert.equal(whatsappMediaContent(message("audioMessage")).type,"audio");
});

test("stream size limits remove partial files and allow a clean later retry",async t=>{
  const key=`wa-media-test-${randomUUID()}`;
  t.after(()=>{for(const f of fs.readdirSync(MEDIA_DIR).filter(f=>f.startsWith(key)))fs.rmSync(path.join(MEDIA_DIR,f));});
  await assert.rejects(saveMediaStream(key,"bin",Readable.from([Buffer.alloc(4),Buffer.alloc(5)]),8),/attachment limit/);
  assert.deepEqual(fs.readdirSync(MEDIA_DIR).filter(f=>f.startsWith(key)),[]);
  const url=await saveMediaStream(key,"bin",Readable.from([Buffer.alloc(4)]),8);
  assert.equal(fs.statSync(path.join(MEDIA_DIR,path.basename(url))).size,4);
});

test("duplicate recover clicks coalesce; a manual request upgrades a failed automatic attempt",async()=>{
  const q=new WhatsAppMediaRecoveryQueue();let finish!:(v?:void)=>void,calls=0;
  const first=q.run("one",false,async()=>{calls++;await new Promise<void>(r=>{finish=r;});});
  assert.equal(first,q.run("one",true,async()=>assert.fail()));
  await Promise.resolve();finish();await first;assert.equal(calls,1);
  const auto=q.run("two",true,async()=>{throw new WhatsAppMediaLimitError(MAX_BYTES,true);});
  const manual=q.run("two",false,async()=>{calls++;});
  await assert.rejects(auto,/automatic/);await manual;assert.equal(calls,2);
  await q.run("three",false,async()=>{calls++;});assert.equal(calls,3);
});

test("Baileys recovery forwards manual/automatic policy and persists one historical update",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"wa-media-adapter-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const adapter:any=new WhatsAppBaileysAdapter({clientId:"fixture"});
  const raw=message();const records=new DurableRecords<string>(directory);
  records.put("whatsapp:123@s.whatsapp.net:TEST",Buffer.from(proto.WebMessageInfo.encode(raw).finish()).toString("base64"));
  const saved:any[]=[],policies:boolean[]=[];
  Object.assign(adapter,{rawMessages:records,state:"ready",sock:{ws:{isOpen:true}},onMessage:async(m:any)=>{saved.push(m);},
    downloadAttachment:async(_m:any,automatic:boolean)=>{policies.push(automatic);return {type:"file",url:"/media/fixture.pdf"};}});
  await Promise.all([adapter.recoverMedia("123@c.us","whatsapp:123@c.us:TEST"),adapter.recoverMedia("123@c.us","whatsapp:123@c.us:TEST")]);
  assert.deepEqual(policies,[false]);assert.equal(saved.length,1);assert.equal(saved[0].historical,true);
  assert.equal(saved[0].messageExternalId,"whatsapp:123@s.whatsapp.net:TEST");
  await adapter.recoverMedia("123@c.us","whatsapp:123@c.us:TEST",{automatic:true});assert.deepEqual(policies,[false,true]);
  await assert.rejects(adapter.recoverMedia("999@c.us","whatsapp:123@c.us:TEST"),/selected chat/);
  assert.equal(saved.length,2);
});

test("Baileys manual recovery does not swallow disk or download errors",async()=>{
  const adapter:any=new WhatsAppBaileysAdapter({clientId:"fixture"});
  Object.assign(adapter,{state:"ready",sock:{ws:{isOpen:true}},readMessage:()=>message(),
    toInbound:async()=>({media:{type:"file",url:null}}),downloadAttachment:async()=>{throw Error("disk fixture failure");},
    onMessage:async()=>assert.fail("failed file reported as recovered")});
  await assert.rejects(adapter.recoverMedia("123@c.us","whatsapp:123@c.us:TEST"),/disk fixture failure/);
});
