import assert from "node:assert/strict";
import test from "node:test";
import { inspect, privatePath } from "./check-release-privacy.mjs";

test("reject private session, database, export and backup paths", () => {
  for (const file of [".env", ".env.production", ".local/session.json", ".baileys_auth/creds.json", "prisma/dev.db-wal", "public/media/message.png", "public/avatars/person.jpg", "outputs/contacts.csv", "archive.bundle", "key.pem", "worker.log"]) {
    assert.equal(privatePath(file), true, file);
  }
});
test("allow empty env templates, schemas, sources and reviewed demo previews", () => {
  for (const file of [".env.example", "prisma/schema.prisma", "sync/discord-search-secrets.ts", "docs/inbox.png"]) assert.equal(privatePath(file), false);
  assert.deepEqual(inspect(".env.example", Buffer.from("X_AUTH_TOKEN=\nTELEGRAM_API_HASH=\n")), []);
});
test("detect synthetic tokens without revealing their contents", () => {
  const token = "ghp_" + "A".repeat(36);
  const report = inspect("example.ts", Buffer.from(`const value = '${token}';`));
  assert.equal(report[0].rule, "GitHub-token");
  assert.equal(report[0].line, 1);
  assert.ok(!JSON.stringify(report).includes(token));
});
test("detect personal contact literals and session material", () => {
  for (const value of ["example-person@" + "outlook.com", '"noiseKey": {}', "/Users/" + "private-person/project"]) {
    assert.ok(inspect("example.txt", Buffer.from(value)).length);
  }
  assert.deepEqual(inspect("example.txt", Buffer.from("person@example.com\n114433728+AZK65@users.noreply.github.com")), []);
});
test("binary data is not rendered as text, but its private pathname is checked", () => {
  assert.equal(inspect("prisma/data.db", Buffer.from([0, 1, 2]))[0].rule, "private-file");
  assert.deepEqual(inspect("docs/inbox.png", Buffer.from([0, 1, 2])), []);
});
