import assert from "node:assert/strict";
import { test } from "node:test";
import { isGifMedia, shouldPlayGif } from "./gif-media";

test("only explicit GIF metadata or GIF filenames qualify", () => {
  assert.equal(isGifMedia({ mediaIsGif: true, mediaUrl: "/media/animation.mp4" }), true);
  assert.equal(isGifMedia({ mediaName: "Reaction.GIF" }), true);
  assert.equal(isGifMedia({ mediaUrl: "/media/reaction.gif?v=2" }), true);
  assert.equal(isGifMedia({ mediaName: "holiday.mp4", mediaUrl: "/media/silent.mp4" }), false);
  assert.equal(isGifMedia({ mediaName: "gif tutorial.mp4" }), false);
  assert.equal(isGifMedia({ mediaUrl: "/media/picture.png?title=test.gif.mp4" }), false);
  assert.equal(isGifMedia({ mediaUrl: "/media/normal.mp4?title=test.gif" }), false);
});

test("GIF autoplay is silent/visible-only, respects reduced motion and manual pause", () => {
  const active = { isGif: true, visible: true, pageVisible: true, reducedMotion: false, intent: null } as const;
  assert.equal(shouldPlayGif(active), true);
  for (const override of [{ isGif: false }, { visible: false }, { pageVisible: false }, { reducedMotion: true }, { intent: "pause" as const }]) {
    assert.equal(shouldPlayGif({ ...active, ...override }), false);
  }
  assert.equal(shouldPlayGif({ ...active, reducedMotion: true, intent: "play" }), true);
  assert.equal(shouldPlayGif({ ...active, visible: false, intent: "play" }), false);
  assert.equal(shouldPlayGif({ ...active, pageVisible: false, intent: "play" }), false);
  assert.equal(shouldPlayGif({ ...active, isGif: false, intent: "play" }), false);
});
