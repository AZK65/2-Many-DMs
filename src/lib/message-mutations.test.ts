import assert from "node:assert/strict";
import { test } from "node:test";
import { messageMutationPolicy, nativeMutationId } from "./message-mutations";
import { mergeMessageWindow } from "./message-timeline";
import type { MessageDTO } from "./types";
const now = Date.now();
const message = { direction: "out", body: "Example", externalKey: "telegram:123:456", createdAt: new Date(now), deliveryStatus: "sent" };

test("connector-specific permissions and WhatsApp time limits", () => {
  assert.equal(messageMutationPolicy("telegram", null, message, now).edit, true);
  assert.equal(messageMutationPolicy("whatsapp", "baileys", message, now).delete, true);
  assert.equal(messageMutationPolicy("whatsapp", "baileys", { ...message, createdAt: new Date(now - 15 * 60000) }, now).edit, false);
  assert.equal(messageMutationPolicy("whatsapp", "baileys", { ...message, createdAt: new Date(now - 48 * 3600000) }, now).delete, false);
  assert.equal(messageMutationPolicy("discord", "bot", message, now).edit, true);
  for (const [platform, driver] of [["discord", "personal-readonly"], ["x", "api"], ["gmail", "oauth"]])
    assert.equal(messageMutationPolicy(platform, driver, message, now).delete, false);
  for (const patch of [{ direction: "in" }, { deliveryStatus: "pending" }, { deliveryStatus: "unconfirmed" },
    { externalKey: null }, { deletedAt: new Date() }, { mutationState: "uncertain" }])
    assert.equal(messageMutationPolicy("telegram", null, { ...message, ...patch }, now).edit, false);
  assert.equal(messageMutationPolicy("telegram", null, { ...message, mediaType: "image" }, now).edit, false);
});

test("X browser actions require verified native IDs, never previews or pending sends", () => {
  const x = { ...message, externalKey: "x:00000000-0000-4000-8000-000000000001" };
  assert.equal(messageMutationPolicy("x", "browser", x, now).edit, true);
  assert.equal(messageMutationPolicy("x", "browser", x, now).delete, true);
  for (const externalKey of ["x:preview:abc", "x:123-456:pending:abc", "x:123-456:123", "x:not-real", "telegram:123:456"])
    assert.equal(messageMutationPolicy("x", "browser", { ...x, externalKey }, now).edit, false);
  assert.equal(messageMutationPolicy("x", "browser", { ...x, direction: "in" }, now).delete, false);
  assert.equal(messageMutationPolicy("x", "browser", { ...x, mediaType: "image" }, now).edit, false);
  assert.equal(messageMutationPolicy("x", "browser", x, now).maxLength, 10000);
});

test("native mutation IDs never accept another chat or preview IDs", () => {
  assert.equal(nativeMutationId("telegram", "123__t7", "telegram:123__t7:456"), "456");
  assert.throws(() => nativeMutationId("telegram", "124", "telegram:123:456"));
  assert.throws(() => nativeMutationId("telegram", "123", "telegram:123:pending:456"));
  assert.throws(() => nativeMutationId("discord", "123", "discord:123:../../456"));
});

test("older polls never undo confirmed edits or revive deleted messages", () => {
  const old = { ...message, id: "test", createdAt: new Date(now).toISOString() } as MessageDTO;
  const edited = { ...old, body: "Changed", editedAt: new Date(now).toISOString() };
  assert.equal(mergeMessageWindow([edited], [old])[0].body, "Changed");
  const deleted = { ...edited, body: "Message deleted", deletedAt: new Date(now + 1).toISOString() };
  assert.equal(mergeMessageWindow([deleted], [edited])[0].deletedAt, deleted.deletedAt);
});
