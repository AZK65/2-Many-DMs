import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

test("starting a member DM preserves identities, reuses verified history, and stays on the selected account", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "omni-direct-conversation-test-"));
  const previousUrl = process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db")}`;
  let db: typeof import("./db") | undefined;
  try {
    const create = spawnSync("sqlite3", [path.join(directory,"test.db"), "PRAGMA user_version=0;"], {encoding:"utf8"});
    assert.equal(create.status,0,create.stderr);
    const setup = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {env:process.env,encoding:"utf8"});
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    db = await import("./db");
    await db.prismaReady;
    const {prisma} = db;
    const {POST} = await import("../app/api/conversations/start/route");
    const {GET} = await import("../app/api/contacts/[id]/direct-conversation/route");
    const user = await prisma.user.create({data:{email:"you@omni-crm.local"}});
    const accounts = await Promise.all(["one","two","empty"].map(label => prisma.account.create({data:{userId:user.id,platform:"whatsapp",label}})));
    const lid = await prisma.contact.create({data:{externalKey:"whatsapp:456@lid",name:"Léo",handle:"Léo"}});
    const phone = await prisma.contact.create({data:{externalKey:"whatsapp:123456789@c.us",name:"My saved name",handle:"+123456789"}});
    await prisma.conversation.create({data:{platform:"whatsapp",accountId:accounts[0].id,externalId:"456@lid",contactId:lid.id}});
    const history = await prisma.conversation.create({data:{platform:"whatsapp",accountId:accounts[0].id,externalId:"123456789@c.us",contactId:phone.id,hidden:true,
      messages:{create:{body:"previous private message",direction:"in"}}}});
    await prisma.conversation.create({data:{platform:"whatsapp",accountId:accounts[1].id,externalId:"123456789@c.us",contactId:phone.id,
      messages:{create:{body:"different account",direction:"in"}}}});
    let resolved = {chatExternalId:"456@lid",externalKey:"whatsapp:456@lid",name:"WhatsApp member",handle:"WhatsApp member",aliases:["456@lid","123456789@s.whatsapp.net"]};
    globalThis.fetch = async url => {
      assert.match(String(url), /\/conversation\/resolve$/);
      return Response.json(resolved);
    };
    const start = (target: string, accountId = accounts[0].id) => POST(new NextRequest("http://localhost/api/conversations/start", {
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"whatsapp",accountId,target}),
    }));
    assert.deepEqual(await (await start("whatsapp:456@lid")).json(), {conversationId:history.id,created:false});
    assert.equal(await prisma.conversation.count(),3);
    assert.equal((await prisma.contact.findUniqueOrThrow({where:{id:phone.id}})).name,"My saved name");
    assert.equal((await prisma.contact.findUniqueOrThrow({where:{id:lid.id}})).name,"Léo");
    assert.equal((await prisma.conversation.findUniqueOrThrow({where:{id:history.id}})).hidden,false);
    assert.equal(await prisma.message.count(),2);
    const preview = await GET(new NextRequest(`http://localhost/api/contacts/${phone.id}/direct-conversation?platform=whatsapp&accountId=${accounts[2].id}`),{params:{id:phone.id}});
    assert.deepEqual(await preview.json(),{conversation:null});
    resolved = {...resolved,chatExternalId:"123456789@s.whatsapp.net",externalKey:"whatsapp:123456789@s.whatsapp.net"};
    const created = await (await start("+123456789",accounts[2].id)).json();
    assert.equal(created.created,true);
    assert.equal((await prisma.conversation.findUniqueOrThrow({where:{id:created.conversationId}})).externalId,"123456789@c.us");
    assert.equal((await (await start("+123456789",accounts[2].id)).json()).created,false);
    const missing = await prisma.contact.create({data:{externalKey:"whatsapp:987@lid",name:"WhatsApp member",handle:"WhatsApp member"}});
    resolved = {chatExternalId:"987@lid",externalKey:"whatsapp:987@lid",name:"Exact sender",handle:"Exact sender",aliases:["987@lid"]};
    await start("987@lid");
    const repaired = await prisma.contact.findUniqueOrThrow({where:{id:missing.id}});
    assert.equal(repaired.name,"Exact sender");
    assert.equal(repaired.phone,null); // An opaque LID must never become a phone.
  } finally {
    globalThis.fetch = originalFetch;
    await db?.prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    rmSync(directory,{recursive:true,force:true});
  }
});
