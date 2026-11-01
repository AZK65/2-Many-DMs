import assert from "node:assert/strict";
import test from "node:test";
import puppeteer, { type Browser } from "puppeteer";
import { mutateXMessage } from "./x-message-mutations";
import { MessageMutationRejected } from "../src/lib/message-mutations";

const id = "00000000-0000-4000-8000-000000000001";
const neighbor = "00000000-0000-4000-8000-000000000002";
const original = "Original fixture https://example.invalid/Keep?A=1";
const edited = "Updated fixture\nhttps://example.invalid/Keep?A=1";
const input = { chat: "111-222", key: `x:${id}`, expectedBody: original };

/** Synthetic observed X Chat markup. ALL requests intercepted; no account,
 * cookies, real messages, or external network are used. */
async function fixture(browser: Browser, options: { mine?: boolean; deleteAll?: boolean; edit?: boolean; persist?: boolean; draft?: string; confirmation?: boolean } = {}) {
  const page = await browser.newPage();
  let body = original, deleted = false, saves = 0, deletes = 0;
  await page.exposeFunction("fixturePersist", async (action: string, value: string) => {
    if (action === "edit") { saves++; if (options.persist !== false) body = value; }
    else { deletes++; if (options.persist !== false) deleted = true; }
  });
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.url() !== "https://x.com/i/chat/111-222") { void request.abort(); return; }
    const config = JSON.stringify({ body, deleted, id, neighbor, ...options }).replace(/</g, "\\u003c");
    void request.respond({ contentType: "text/html", body: `<!doctype html><div data-testid="xchatEmbedRoute"></div><script>
      const c=${config}; const root=document.querySelector('div').attachShadow({mode:'open'});
      root.innerHTML='<style>button,textarea{display:block;min-height:30px} [data-dm-message-row]{min-height:80px} [dir=auto]{white-space:pre-wrap}</style><div data-testid="dm-message-list"></div><textarea data-testid="dm-composer-textarea"></textarea>';
      const list=root.querySelector('[data-testid="dm-message-list"]'); const composer=root.querySelector('textarea'); composer.value=c.draft||'';
      const row=document.createElement('div'); row.setAttribute('data-dm-message-row',c.id);row.dataset.testid='message-'+c.id;row.dataset.sendStatus='sent';
      row.innerHTML='<span hidden id="fixture-sender">'+(c.mine===false?'Other person':'You')+'</span><div data-dm-message-focus-target="content"><div data-testid="message-text-'+c.id+'"><span dir="auto"></span></div><button aria-label="More">More</button></div>';
      const text=row.querySelector('[dir=auto]');text.textContent=c.body;
      const before=document.createElement('div');before.setAttribute('data-dm-message-row',c.neighbor);before.textContent='Previous fixture'; list.append(before); if(!c.deleted)list.append(row);
      const clear=()=>{root.querySelectorAll('[role=menu],[role=dialog],[data-testid="dm-composer-discard-edit-button"],[data-testid="dm-composer-send-button"]').forEach(el=>el.remove());composer.value='';};
      const remove=async()=>{await window.fixturePersist('delete','');row.remove();clear();};
      row.querySelector('button').onclick=()=>{const menu=document.createElement('div');menu.role='menu';root.append(menu);
        const item=(label,fn)=>{const b=document.createElement('button');b.role='menuitem';b.textContent=label;b.onclick=fn;menu.append(b);};
        if(c.edit!==false)item('Edit message',()=>{menu.remove();composer.value=text.textContent;const cancel=document.createElement('button');cancel.dataset.testid='dm-composer-discard-edit-button';cancel.textContent='Discard edit';cancel.onclick=clear;root.append(cancel);const save=document.createElement('button');save.dataset.testid='dm-composer-send-button';save.setAttribute('aria-label','Save');save.textContent='Save';save.onclick=async()=>{const value=composer.value;await window.fixturePersist('edit',value);text.textContent=value;clear();};root.append(save);});
        item('Delete for me',()=>{throw new Error('Must never click Delete for me');});
        if(c.deleteAll!==false)item('Delete for all',()=>{menu.remove();if(!c.confirmation){void remove();return;}const d=document.createElement('div');d.role='dialog';d.innerHTML='<h2>Delete message for all?</h2><button>Cancel</button><button>Delete</button>';d.querySelectorAll('button')[0].onclick=()=>d.remove();d.querySelectorAll('button')[1].onclick=remove;root.append(d);});
      };
    </script>` });
  });
  await page.goto("https://x.com/i/chat/111-222");
  return { page, counts: () => ({ saves, deletes, body, deleted }) };
}

test("native X edit/delete verify exact messages and persist across reload", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const f = await fixture(browser);
    await mutateXMessage(f.page, { ...input, action: "edit", body: edited });
    assert.equal(f.counts().saves, 1); assert.equal(f.counts().body, edited);
    await mutateXMessage(f.page, { ...input, expectedBody: edited, action: "delete" });
    assert.equal(f.counts().deletes, 1); assert.equal(f.counts().deleted, true);
    await f.page.close();
    const confirmation = await fixture(browser, { confirmation: true });
    await mutateXMessage(confirmation.page, { ...input, action: "delete" });
    assert.equal(confirmation.counts().deletes, 1);
  } finally { await browser.close(); }
});

test("native X preflight rejects unsupported actions, foreign senders, stale text and drafts without mutation", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    for (const options of [{ mine: false }, { deleteAll: false }, { draft: "Keep my unsent draft" }]) {
      const f = await fixture(browser, options);
      await assert.rejects(mutateXMessage(f.page, { ...input, action: "delete" }), MessageMutationRejected);
      assert.equal(f.counts().saves + f.counts().deletes, 0);
      if (options.draft) assert.equal(await f.page.$eval('pierce/textarea', el => (el as HTMLTextAreaElement).value), options.draft);
      await f.page.close();
    }
    const f = await fixture(browser, { edit: false });
    await assert.rejects(mutateXMessage(f.page, { ...input, action: "edit", body: edited }), /does not offer Edit message/);
    await assert.rejects(mutateXMessage(f.page, { ...input, expectedBody: "Stale", action: "edit", body: edited }), /differs/);
    await assert.rejects(mutateXMessage(f.page, { ...input, key: "x:preview:fake", action: "delete" }), /verified native/);
    await assert.rejects(mutateXMessage(f.page, { ...input, chat: "333-444", action: "delete" }), /conversation changed/);
    assert.equal(f.counts().saves + f.counts().deletes, 0);
  } finally { await browser.close(); }
});

test("optimistic native X changes are not accepted as remote success", async () => {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    for (const action of ["edit", "delete"] as const) {
      const f = await fixture(browser, { persist: false });
      await assert.rejects(mutateXMessage(f.page, { ...input, action, body: edited }), error => {
        assert.ok(!(error instanceof MessageMutationRejected), "committed but unconfirmed must never unlock a retry");
        return /confirm the saved result/.test(String(error));
      });
      assert.equal(f.counts().saves + f.counts().deletes, 1);
      await f.page.close();
    }
  } finally { await browser.close(); }
});

