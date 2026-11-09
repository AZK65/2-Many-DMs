import assert from "node:assert/strict";
import test from "node:test";
import { isSharedXPostMessage, normalizedXPostUrl, xPostTextFromOembed, xPostUrlFromText } from "./x-post-preview";

test("X post previews accept bare and fully-qualified status links only", () => {
  assert.equal(normalizedXPostUrl("x.com/finityx/status/2012584288298901546?s=20"),
    "https://x.com/finityx/status/2012584288298901546");
  assert.equal(normalizedXPostUrl("https://twitter.com/user/status/123"), "https://x.com/user/status/123");
  assert.equal(normalizedXPostUrl("https://x.com/user"), null);
  assert.equal(normalizedXPostUrl("https://example.com/user/status/123"), null);
});

test("shared X posts are recognized inside a DM body", () => {
  assert.equal(xPostUrlFromText("Sent a post\nhttps://twitter.com/finityx/status/2012584288298901546?s=20"),
    "https://x.com/finityx/status/2012584288298901546");
  assert.equal(isSharedXPostMessage("Sent a post\nx.com/finityx/status/2012584288298901546"), true);
  assert.equal(isSharedXPostMessage("https://x.com/finityx/status/2012584288298901546"), true);
  assert.equal(isSharedXPostMessage("Look at this x.com/finityx/status/2012584288298901546"), false);
});

test("X oEmbed HTML is reduced to safe post text", () => {
  assert.equal(xPostTextFromOembed('<blockquote><p lang="en">Hello <a href="https://x.com/a">@a</a> &amp; team<br>Line 2</p></blockquote>'),
    "Hello @a & team\nLine 2");
  assert.equal(xPostTextFromOembed("<blockquote>Missing text</blockquote>"), null);
});
