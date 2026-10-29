import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discordReadPath, discordRetryDelay, privateDiscordMessage, type DiscordSearchMessage } from "./discord-search-core";
import { DiscordSearchAdapter } from "./adapters/discord-search";
import { encryptDiscordSearchSession, decryptDiscordSearchSession } from "./discord-search-secrets";

const chat = { id: "123", type: 1, recipients: [{ id: "456", username: "customer", global_name: "Customer", avatar: "abc123" }] };
const raw: DiscordSearchMessage = { id: "789", channel_id: "123", timestamp: "2026-10-29T13:00:00Z", content: "client@example.com", author: { id: "456", username: "customer" } };
test("private messages preserve native identity, timestamps, email search, and read-only semantics", () => {
  const result = privateDiscordMessage(chat, raw, "999")!;
  assert.equal(result.body, "client@example.com");
  assert.equal(result.messageExternalId, "discord:123:789");
  assert.equal(result.timestamp.getTime(), new Date(raw.timestamp).getTime());
  assert.equal(result.historical, true);
  assert.equal(result.direction, "in");
  assert.equal(result.contact.name, "Customer");
  assert.match(result.contact.avatarUrl!, /^https:\/\/cdn.discordapp.com\/avatars\/456\//);
});
test("outbound echoes remain searchable without enabling sends", () => {
  assert.equal(privateDiscordMessage(chat, { ...raw, author: { id: "999" } }, "999")?.direction, "out");
});
test("groups retain sender identity and quoted context", () => {
  const result = privateDiscordMessage({ ...chat, type: 3, name: "Partners" }, { ...raw, message_reference: { message_id: "788" }, referenced_message: { content: "Email?", author: { id: "999", username: "me" } } }, "999")!;
  assert.equal(result.isGroup, true);
  assert.equal(result.sender?.externalKey, "discord-user:456");
  assert.equal(result.replyToExternalKey, "discord:123:788");
  assert.equal(result.replyPreview, "Email?");
});
test("rejects server channels, mixed-channel messages, missing authors, and invalid dates", () => {
  assert.equal(privateDiscordMessage({ ...chat, type: 0 }, raw, "999"), null);
  assert.equal(privateDiscordMessage(chat, { ...raw, channel_id: "124" }, "999"), null);
  assert.equal(privateDiscordMessage(chat, { ...raw, timestamp: "bad" }, "999"), null);
  assert.equal(privateDiscordMessage(chat, { ...raw, author: { id: "" } }, "999"), null);
});
test("only narrowly scoped read paths are accepted", () => {
  for (const valid of ["/users/@me", "/users/@me/channels", "/gateway", "/channels/123/messages?limit=100&before=456", "/channels/123/messages/789"]) assert.equal(discordReadPath(valid), true);
  for (const invalid of ["/users/@me/relationships", "/channels/123/messages/789/ack", "/guilds/123/channels", "/channels/123/messages?token=secret", "https://evil.test", "/channels/../users/@me"]) assert.equal(discordReadPath(invalid), false);
});
test("rate-limit cooldown honors the longer server delay with margin", () => {
  assert.equal(discordRetryDelay(20, "5"), 21000);
  assert.equal(discordRetryDelay(1, "30"), 31000);
  assert.equal(discordRetryDelay(undefined, null), 2000);
});
test("adapter cannot send, react, acknowledge, or create groups", async () => {
  const adapter = new DiscordSearchAdapter({ token: "test", userId: "999", username: "me" }, "test");
  await assert.rejects(adapter.send(), /read-only/);
  for (const capability of ["react", "markRead", "createGroup", "archiveChat"]) assert.equal(capability in adapter, false);
  assert.equal(adapter.matchesSession(JSON.stringify({ token: "test", userId: "999" })), true);
  assert.equal(adapter.matchesSession(JSON.stringify({ token: "other", userId: "999" })), false);
  await adapter.stop();
});
test("history checkpoints never advance past a failed middle page", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omni-discord-test-"));
  const adapter = new DiscordSearchAdapter({ token: "test", userId: "999", username: "me" }, "test");
  // Exercise the real scheduler without network or the production database.
  const internal = adapter as unknown as {
    checkpointFile: string; checkpoint: { version: number; userId: string; chats: Record<string, { since: number; latestId?: string; recent?: { before?: string }; blockedUntil?: number }> };
    channels: Map<string, typeof chat>; jobs: { chatId: string; mode: string; since: number; stopId: string }[];
    request: () => Promise<DiscordSearchMessage[]>; onMessage: () => Promise<void>; drainHistory: () => Promise<void>;
  };
  internal.checkpointFile = path.join(directory, "checkpoint.json");
  internal.channels.set("123", chat);
  internal.checkpoint.chats["123"] = { since: 0, latestId: "500" };
  internal.jobs = [{ chatId: "123", mode: "recent", since: 0, stopId: "500" }];
  let calls = 0; let saved = 0;
  internal.onMessage = async () => { saved++; };
  internal.request = async () => {
    calls++;
    if (calls === 2) throw new Error("Temporary outage");
    return Array.from({ length: 100 }, (_, i) => ({ ...raw, id: String(1000 - i) }));
  };
  await internal.drainHistory();
  assert.equal(saved, 100);
  const checkpoint = JSON.parse(await fs.readFile(internal.checkpointFile, "utf8"));
  assert.equal(checkpoint.chats["123"].latestId, "500");
  assert.equal(checkpoint.chats["123"].recent.before, "901");
  assert.ok(checkpoint.chats["123"].blockedUntil > Date.now());
  await adapter.stop();
  await fs.rm(directory, { recursive: true, force: true });
});
test("session encryption uses a private local key and detects tampering", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omni-discord-key-test-"));
  const plain = JSON.stringify({ token: "fixture-only", userId: "999" });
  const encrypted = encryptDiscordSearchSession(plain, directory);
  assert.equal(encrypted.includes("fixture-only"), false);
  assert.equal(decryptDiscordSearchSession(encrypted, directory), plain);
  assert.equal((await fs.stat(path.join(directory, "session-key"))).mode & 0o777, 0o600);
  const parts = encrypted.split("."); parts[1] = Buffer.alloc(16).toString("base64");
  assert.throws(() => decryptDiscordSearchSession(parts.join("."), directory));
  await fs.rm(directory, { recursive: true, force: true });
});
