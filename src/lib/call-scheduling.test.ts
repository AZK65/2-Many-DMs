import assert from "node:assert/strict";
import test from "node:test";
import { mentionsCallIntent } from "./call-scheduling";

test("detects common call scheduling language", () => {
  assert.equal(mentionsCallIntent("Can we schedule a call tomorrow?"), true);
  assert.equal(mentionsCallIntent("Let's meet at 3 PM"), true);
  assert.equal(mentionsCallIntent("I will send a Zoom invite"), true);
});

test("does not match partial words", () => {
  assert.equal(mentionsCallIntent("Please recall the message"), false);
  assert.equal(mentionsCallIntent("The meetup notes are attached"), false);
});
