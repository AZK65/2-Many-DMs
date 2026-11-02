import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localOllamaOrigin, localOllamaFetch, requireLocalModel } from "./local-ollama";
import { localPhotoPath, recognizeLocalPhoto, cleanOcrText } from "./local-ocr";
import { photoTranslationService, type PhotoRecord } from "./photo-translation";
import { translateText } from "./translation";

test("local AI rejects remote, credentialed and path-based endpoints before fetch", async () => {
  for (const value of ["https://api.example.com", "http://192.168.1.2:11434", "http://127.0.0.1.evil.test", "http://user:pass@localhost", "http://localhost/proxy", "http://localhost/?key=secret", "http://localhost/#proxy", "https://localhost"]) assert.throws(() => localOllamaOrigin(value));
  assert.equal(localOllamaOrigin("http://localhost:11434"), "http://127.0.0.1:11434");
  assert.equal(localOllamaOrigin("http://[::1]:11434"), "http://[::1]:11434");
  const saved = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://example.com";
  try { await assert.rejects(localOllamaFetch("/api/chat"), /on this machine/); }
  finally { if (saved === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = saved; }
});

test("cloud model aliases and missing/unverified weights never receive image or text", async () => {
  const saved = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(init?.redirect, "error"); assert.deepEqual(JSON.parse(String(init?.body)), { model: "photo:local" }); return Response.json({ remote_model: "cloud", model_info: { architecture: "remote" } }); };
  try {
    await assert.rejects(requireLocalModel("vision:cloud"), /Cloud models/); assert.equal(calls, 0);
    await assert.rejects(requireLocalModel("photo:local"), /Cloud inference is disabled/);
    globalThis.fetch = async () => Response.json({}, { status: 404 });
    await assert.rejects(requireLocalModel("photo:local"), /ollama pull photo:local/);
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(requireLocalModel("photo:local"), /verify downloaded/);
    globalThis.fetch = async () => Response.json({ model_info: { architecture: "vision" } });
    await requireLocalModel("photo:local");
  } finally { globalThis.fetch = saved; }
});

test("only exact workspace media filenames are accepted", () => {
  for (const value of ["https://example.com/photo.png", "data:image/png;base64,eA==", "/media/../secret", "/media/%2e%2e%2fsecret", "/media/sub/file.png", "/media/a%5cb.png", "/media/%00", "/media/..", "/media/a?token=1"]) assert.throws(() => localPhotoPath(value));
  assert.equal(localPhotoPath("/media/hello%20world.png", "/workspace"), "/workspace/public/media/hello world.png");
  assert.equal(cleanOcrText("```text\nBonjour\n```"), "Bonjour");
  assert.equal(cleanOcrText("No text found."), "");
  assert.equal(cleanOcrText("Total\nTotal"), "Total\nTotal", "real duplicate labels are preserved");
});

test("OCR reads local bytes, never follows redirects, and reports blank, truncated and unsupported images", async () => {
  const fixture = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "photo-ocr-test-"));
  const folder = path.join(fixture, "public/media"); await fs.mkdir(folder, { recursive: true });
  const bytes = Buffer.from([137,80,78,71,13,10,26,10,1]); await fs.writeFile(path.join(folder, "photo.png"), bytes);
  const saved = globalThis.fetch; let answer: any = { message: { content: JSON.stringify({ text: "Bonjour\nMerci" }) }, done_reason: "stop", eval_count: 4 }; let count = 0;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith("http://127.0.0.1:")); assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/api/show")) return Response.json({ model_info: { architecture: "glm" } });
    count++; const input = JSON.parse(String(init?.body));
    assert.deepEqual(input.messages[0].images, [bytes.toString("base64")]); assert.equal(input.stream, false); assert.equal(input.options.num_predict, 4096);
    return Response.json(answer);
  };
  try {
    assert.equal(await recognizeLocalPhoto("/media/photo.png", { root: fixture }), "Bonjour\nMerci");
    answer = { message: { content: '{"text":""}' }, done_reason: "stop" }; assert.equal(await recognizeLocalPhoto("/media/photo.png", { root: fixture }), "");
    answer = { response: "Partial", done_reason: "length" }; await assert.rejects(recognizeLocalPhoto("/media/photo.png", { root: fixture }), /silently cut off/);
    const before = count;
    await fs.writeFile(path.join(folder, "bad.png"), "not a photo");
    await assert.rejects(recognizeLocalPhoto("/media/bad.png", { root: fixture }), /PNG, JPEG and WebP/);
    await assert.rejects(recognizeLocalPhoto("/media/missing.png", { root: fixture }), /Recover/);
    await fs.symlink(path.join(folder, "photo.png"), path.join(folder, "link.png"));
    await assert.rejects(recognizeLocalPhoto("/media/link.png", { root: fixture }), /regular local/);
    assert.equal(count, before);
  } finally { globalThis.fetch = saved; await fs.rm(fixture, { recursive: true, force: true }); }
});

function fixtureService() {
  let photo: PhotoRecord | null = { id: "photo", conversationId: "chat", mediaType: "image", mediaUrl: "/media/photo.png", deletedAt: null, ocrText: null, ocrStatus: null, ocrModel: null };
  let reads = 0, translations = 0;
  const service = photoTranslationService({ find: async () => photo && { ...photo }, save: async (_photo, text, model) => { if (!photo || photo.deletedAt) return false; photo.ocrText = text; photo.ocrModel = model; photo.ocrStatus = "complete"; return true; } }, {
    recognize: async () => { reads++; return "Bonjour"; },
    translate: async (text, target, _hint, _samples, mode) => { translations++; assert.equal(text, "Bonjour"); assert.equal(mode, "photo"); assert.equal(target.code, "en"); return { translatedText: "Hello", detectedLanguageCode: "fr", detectedLanguageName: "French", targetLanguageCode: "en", targetLanguageName: "English" }; },
  });
  return { service, set: (value: PhotoRecord | null) => { photo = value; }, get: () => photo!, counts: () => [reads, translations] };
}

test("photo pipeline recognizes, saves searchable text and translates without editing message or image", async () => {
  const f = fixtureService();
  await assert.rejects(f.service("chat", "photo", "translate"), /Read the photo/);
  f.set({ ...f.get(), ocrText: "Background snippet", ocrStatus: "complete", ocrModel: "background-indexer" });
  await assert.rejects(f.service("chat", "photo", "translate"), /Read the photo/, "short background snippets cannot be translated as full photos");
  assert.deepEqual(await f.service("chat", "photo", "recognize"), { originalText: "Bonjour", empty: false });
  assert.equal((await f.service("chat", "photo", "translate")).translatedText, "Hello");
  assert.equal(f.get().mediaUrl, "/media/photo.png"); assert.deepEqual(f.counts(), [1, 1]);
});

test("photo lookup rejects other chats, deleted messages, missing and remote attachments", async () => {
  const f = fixtureService();
  await assert.rejects(f.service("other-chat", "photo", "recognize"), /not found/);
  for (const change of [{ mediaType: "video" }, { mediaUrl: "https://example.com/photo" }, { mediaUrl: null }, { deletedAt: new Date() }]) {
    const previous = { ...f.get() }; f.set({ ...previous, ...change });
    await assert.rejects(f.service("chat", "photo", "recognize")); f.set(previous);
  }
  assert.deepEqual(f.counts(), [0, 0]);
});

test("duplicate requests coalesce and a failed read can be retried", async () => {
  const f = fixtureService();
  await Promise.all([f.service("chat", "photo", "recognize"), f.service("chat", "photo", "recognize")]);
  assert.equal(f.counts()[0], 1);
  let attempt = 0;
  const service = photoTranslationService({ find: async () => f.get(), save: async () => true }, {
    recognize: async () => { if (++attempt === 1) throw new Error("Ollama offline"); return "Bonjour"; }, translate: translateText,
  });
  await assert.rejects(service("chat", "photo", "recognize"), /offline/);
  assert.equal((await service("chat", "photo", "recognize")).originalText, "Bonjour");
});

test("photo translation preserves addresses and rejects silently truncated model output", async () => {
  const saved = globalThis.fetch; let truncated = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/show")) return Response.json({ model_info: { architecture: "gemma" } });
    const input = JSON.parse(String(init?.body));
    if (input.format) return Response.json({ message: { content: JSON.stringify({ languageCode: "fr", languageName: "French" }) } });
    assert.equal(input.options.num_predict, 4096); assert.ok(input.messages[0].content.includes("extracted from a photo"));
    assert.ok(!input.messages[0].content.includes("https://example.com/"));
    return Response.json({ message: { content: "Hello OMNI_LINK_0_END" }, done_reason: truncated ? "length" : "stop" });
  };
  try {
    assert.equal((await translateText("Bonjour https://example.com/Bonjour?x=Un", { code: "en", name: "English" }, undefined, [], "photo")).translatedText, "Hello https://example.com/Bonjour?x=Un");
    truncated = true; await assert.rejects(translateText("Bonjour", { code: "en", name: "English" }, undefined, [], "photo"), /text limit/);
  } finally { globalThis.fetch = saved; }
});
