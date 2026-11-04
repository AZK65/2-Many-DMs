import assert from "node:assert/strict";
import test from "node:test";
import { messageLinks } from "./message-links";

test("message links include bare X and ordinary domain paths", () => {
  assert.deepEqual(messageLinks("See x.com/finityx/status/123?s=20")[0], {
    start: 4,
    matched: "x.com/finityx/status/123?s=20",
    url: "https://x.com/finityx/status/123?s=20",
    trailingPunctuation: "",
  });
  assert.equal(messageLinks("Open app.example.com/docs.")[0].url, "https://app.example.com/docs");
  assert.equal(messageLinks("Open app.example.com/docs.")[0].trailingPunctuation, ".");
  assert.equal(messageLinks("Use https://example.com/path")[0].url, "https://example.com/path");
});

test("message links do not turn email domains into links", () => {
  assert.deepEqual(messageLinks("Email person@example.com/path"), []);
});
