import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET } from "./[filename]/route";

test("runtime avatars serve files created after startup, revalidate, and reject traversal", async () => {
  const previous = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-avatar-route-test-"));
  try {
    process.chdir(dir);
    const params = { filename: "telegram_123.jpg" };
    const request = new NextRequest("http://localhost/api/avatars/telegram_123.jpg");
    const missing = await GET(request, { params });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    fs.mkdirSync("public/avatars", { recursive: true });
    fs.writeFileSync("public/avatars/telegram_123.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const loaded = await GET(request, { params });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers.get("content-type"), "image/jpeg");
    assert.equal((await loaded.arrayBuffer()).byteLength, 4);
    const conditional = new NextRequest(request.url, { headers: { "if-none-match": loaded.headers.get("etag")! } });
    assert.equal((await GET(conditional, { params })).status, 304);
    fs.appendFileSync("public/avatars/telegram_123.jpg", Buffer.from([0]));
    assert.equal((await GET(conditional, { params })).status, 200);
    assert.equal((await GET(request, { params: { filename: "../secret.jpg" } })).status, 400);
  } finally {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
