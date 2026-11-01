import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { updatePreferenceStore } from "./update-preferences";
import { autoUpdateSeconds, type AutoUpdateInputs } from "./auto-update-policy";
import { selfUpdateEnabled, updateMutationAllowed } from "./update-access";
import { acquireWorkerLock } from "../../sync/worker-lock";
import { NextRequest } from "next/server";

const revision = "a".repeat(40);
const newer = "b".repeat(40);
test("preference API persists opt-in and skips, rejects forged writes, and never exposes attempt mutation", async () => {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-api-"));
  const api = await import("../app/api/updates/preferences/route");
  const apply = await import("../app/api/updates/apply/route");
  const request = (body?: unknown, origin = "http://localhost:3000") => new NextRequest("http://localhost:3000/api/updates/preferences", {
    method: body === undefined ? "GET" : "PATCH", headers: { host: "localhost:3000", origin, "x-omnicrm-update": "1", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  process.chdir(root);
  try {
    assert.equal((await (await api.GET(request())).json()).autoUpdate, false);
    assert.equal((await api.PATCH(request({ autoUpdate: true }, "https://other.example"))).status, 403);
    assert.equal((await api.PATCH(request({ attemptedRevision: revision }))).status, 400);
    assert.equal((await api.PATCH(request({ autoUpdate: true }))).status, 200);
    assert.equal((await (await api.GET(request())).json()).autoUpdate, true);
    assert.equal((await api.PATCH(request({ skippedRevision: revision }))).status, 200);
    assert.equal((await (await api.GET(request())).json()).skippedRevision, revision);
    assert.equal((await api.PATCH(request({ autoUpdate: false }))).status, 200);
    assert.equal((await apply.POST(request({ expectedRevision: "not-a-revision" }))).status, 400);
    assert.equal(fs.existsSync(path.join(root, ".local/updates/installation")), false);
  } finally { process.chdir(previous); }
});
test("preferences are opt-in, durable, validated and do not erase skips when toggled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-preferences-"));
  const store = updatePreferenceStore(root);
  assert.equal(store.read().autoUpdate, false);
  assert.throws(() => store.claimAutomatic(revision), /turned off/);
  store.patch({ autoUpdate: true });
  store.patch({ skippedRevision: revision });
  store.patch({ autoUpdate: false });
  store.patch({ autoUpdate: true });
  assert.equal(updatePreferenceStore(root).read().skippedRevision, revision);
  assert.throws(() => store.claimAutomatic(revision), /skipped/);
  for (const invalid of [{ autoUpdate: "yes" }, { attemptedRevision: revision }, { skippedRevision: "../unsafe" }, [], null, {}]) assert.throws(() => store.patch(invalid), /Invalid/);
  assert.equal(store.read().autoUpdate, true);
  store.claimAutomatic(newer);
  assert.throws(() => updatePreferenceStore(root).claimAutomatic(newer), /already attempted/);
  assert.equal(fs.statSync(path.join(root, ".local/updates/preferences/settings.json")).mode & 0o777, 0o600);
});
test("concurrent preference writes fail closed and corrupt files never enable updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-guard-"));
  const store = updatePreferenceStore(root);
  store.patch({ autoUpdate: true });
  const lock = acquireWorkerLock(path.join(root, ".local/updates/preferences"));
  try { assert.throws(() => store.patch({ autoUpdate: false }), /already owns/); }
  finally { lock.release(); }
  store.patch({ autoUpdate: false });
  assert.equal(store.read().autoUpdate, false);
  fs.writeFileSync(path.join(root, ".local/updates/preferences/settings.json"), "broken");
  assert.throws(() => store.read(), /paused/);
  assert.throws(() => store.claimAutomatic(revision), /paused/);
});
const ready: AutoUpdateInputs = { enabled: true, configurable: true, ready: true, preview: false, visible: true, busy: false, blocked: false, hasDraft: false,
  revision, skipped: null, attempted: null, noticedAt: 1000, lastActivityAt: 1000, now: 1000 };
test("auto updates wait a full minute and restart the countdown after activity", () => {
  assert.equal(autoUpdateSeconds(ready), 60);
  assert.equal(autoUpdateSeconds({ ...ready, now: 60_999 }), 1);
  assert.equal(autoUpdateSeconds({ ...ready, now: 61_000 }), 0);
  assert.equal(autoUpdateSeconds({ ...ready, now: 61_000, lastActivityAt: 60_000 }), 59);
});
test("preview, skip, opt-out, failed checks, drafts, busy/hidden tabs and attempted releases never auto install", () => {
  const blocked: Partial<AutoUpdateInputs>[] = [{ enabled: false }, { configurable: false }, { ready: false }, { preview: true }, { visible: false }, { busy: true }, { blocked: true }, { hasDraft: true }, { revision: null }, { skipped: revision }, { attempted: revision }];
  for (const state of blocked) assert.equal(autoUpdateSeconds({ ...ready, now: 500_000, ...state }), null, JSON.stringify(state));
  assert.equal(autoUpdateSeconds({ ...ready, now: 500_000, skipped: newer }), 0);
});
test("mutations require local or explicit access, same origin, a custom header and main workspace", () => {
  const prior = { allow: process.env.ALLOW_SELF_UPDATE, workspace: process.env.OMNI_WORKSPACE_ID };
  delete process.env.ALLOW_SELF_UPDATE; delete process.env.OMNI_WORKSPACE_ID;
  const request = (host = "localhost:3000", origin = "http://localhost:3000", header = "1") => new Request(`http://${host}/api/updates/preferences`, { headers: { host, origin, "x-omnicrm-update": header } });
  try {
    assert.equal(updateMutationAllowed(request()), true);
    assert.equal(updateMutationAllowed(request(undefined, "https://untrusted.example")), false);
    assert.equal(updateMutationAllowed(request(undefined, undefined, "")), false);
    assert.equal(selfUpdateEnabled(request("remote.example", "https://remote.example")), false);
    process.env.ALLOW_SELF_UPDATE = "0"; assert.equal(updateMutationAllowed(request()), false);
    process.env.ALLOW_SELF_UPDATE = "1"; assert.equal(updateMutationAllowed(request("remote.example", "https://remote.example")), true);
    process.env.OMNI_WORKSPACE_ID = "isolated"; assert.equal(updateMutationAllowed(request()), false);
  } finally {
    for (const [key, value] of [["ALLOW_SELF_UPDATE", prior.allow], ["OMNI_WORKSPACE_ID", prior.workspace]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});
