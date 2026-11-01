import assert from "node:assert/strict";
import { test } from "node:test";
import { protectTranslationLinks } from "./translation-links";
import { translateText } from "./translation";

test("URL paths, query strings, fragments, emails, bare links and deep links survive byte-for-byte", () => {
  for (const link of ["https://Example.com/Create-Account?ref=My%20Name&locale=en#Start", "example.com/onboarding",
    "www.example.org/hello", "tg://resolve?domain=Example", "Person+test@example.com", "https://example.com/a_(b)", "https://例子.中国/你好"]) {
    const protectedText = protectTranslationLinks(`Visit ${link} now`);
    assert.ok(!protectedText.masked.includes(link));
    assert.equal(protectedText.restore(protectedText.masked.replace("Visit", "Visitez").replace("now", "maintenant")), `Visitez ${link} maintenant`);
  }
});

test("Markdown, repeated addresses and placeholder collisions remain intact", () => {
  for (const text of ["Open [this link](https://example.com/a_(b)).", "Go https://example.com and https://example.com", "OMNI_LINK_0_END is text; see https://example.com"]) {
    const protectedText = protectTranslationLinks(text);
    assert.equal(protectedText.restore(protectedText.masked), text);
  }
});

test("missing, duplicated, changed placeholders or invented links fail closed", () => {
  const protectedText = protectTranslationLinks("Go https://example.com/start");
  for (const output of ["Allez", "Go LIEN_0_END", `${protectedText.masked} OMNI_LINK_0_END`, `${protectedText.masked} https://other.example.org`, `${protectedText.masked}/translated`, `${protectedText.masked}?lang=fr`]) {
    assert.throws(() => protectedText.restore(output), /Nothing was sent/);
  }
});

test("link-only messages bypass Ollama; mixed text masks links and verifies the model result", async () => {
  const savedFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const prompt = JSON.parse(String(init?.body)).messages[0].content;
    assert.ok(!prompt.includes("https://example.com"));
    return Response.json({ message: { content: "Regarde OMNI_LINK_0_END" } });
  };
  try {
    const target = { code: "fr", name: "French" };
    const link = "https://example.com/start?from=Hello%20World#go";
    assert.equal((await translateText(link, target)).translatedText, link);
    assert.equal(calls, 0);
    assert.equal((await translateText(`See ${link}`, target)).translatedText, `Regarde ${link}`);
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ message: { content: "Regarde https://example.com/debut" } });
    await assert.rejects(translateText(`See ${link}`, target), /Nothing was sent/);
  } finally { globalThis.fetch = savedFetch; }
});
