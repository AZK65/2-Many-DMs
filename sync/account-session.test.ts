import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { accountStoragePath, xSessionCookies } from "./account-session";
import { XAdapter } from "./adapters/x";
import { WhatsAppBaileysAdapter } from "./adapters/whatsapp-baileys";

test("per-account browser state is isolated and legacy paths remain stable", () => {
  assert.equal(accountStoragePath("/tmp/example", ".x_profile"), "/tmp/example/.x_profile");
  assert.notEqual(accountStoragePath("/tmp/example", ".x_profile", "one"), accountStoragePath("/tmp/example", ".x_profile", "two"));
  assert.ok(accountStoragePath("/tmp/example", ".x_profile", "../../outside").startsWith("/tmp/example/.x_profile_"));
});
test("X browser uses the exact imported cookie pair and per-account storage", () => {
  const session = { authToken: "fixture-token", ct0: "fixture-csrf" };
  assert.equal(xSessionCookies(session)?.[0].value, "fixture-token");
  assert.equal(xSessionCookies(session)?.[1].value, "fixture-csrf");
  const first = new XAdapter({ accountId: "one", session }) as any;
  const second = new XAdapter({ accountId: "two", session }) as any;
  assert.notEqual(first.storagePath(".x_profile"), second.storagePath(".x_profile"));
  assert.deepEqual(first.session, session);
});
test("Baileys QR refresh cannot restart a linked device and is paced", async () => {
  const adapter = new WhatsAppBaileysAdapter({ clientId: "fixture" }) as any;
  adapter.state = "ready";
  await assert.rejects(adapter.refreshQr(), /already linking/);
  adapter.state = "qr"; adapter.qr = "old-qr";
  const recover = mock.method(adapter, "recover", async () => {});
  try {
    await adapter.refreshQr(); assert.equal(adapter.qr, null); assert.equal(recover.mock.callCount(), 1);
    await assert.rejects(adapter.refreshQr(), /Wait a few seconds/);
    assert.equal(recover.mock.callCount(), 1);
  } finally { recover.mock.restore(); }
});
