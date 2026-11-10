import assert from "node:assert/strict";
import test from "node:test";
import { applyInstantAutocorrect, autocorrectScopeAtCaret } from "./autocorrect-common";

test("common message typos correct immediately without changing casing or protected text", () => {
  const result = applyInstantAutocorrect("Teh adress is wierd , email teh@example.com");
  assert.equal(result.text, "The address is weird, email teh@example.com");
  assert.deepEqual(result.corrections, [
    { from: "punctuation spacing", to: "fixed" },
    { from: "adress", to: "address" },
    { from: "Teh", to: "The" },
    { from: "wierd", to: "weird" },
  ]);
});

test("instant autocorrect keeps valid shorthand and is idempotent", () => {
  const first = applyInstantAutocorrect("idk rn, the calendar is fine");
  assert.equal(first.changed, false);
  assert.deepEqual(applyInstantAutocorrect(first.text), first);
});

test("instant autocorrect fixes an obvious repeated letter while composing", () => {
  assert.equal(applyInstantAutocorrect("can we pleasee check").text, "can we please check");
  assert.equal(applyInstantAutocorrect("can we chek this").text, "can we check this");
});

test("punctuation cleanup can be disabled without disabling spelling fixes", () => {
  const result = applyInstantAutocorrect("teh message ,", { fixPunctuation: false });
  assert.equal(result.text, "the message ,");
  assert.deepEqual(result.corrections, [{ from: "teh", to: "the" }]);
});

test("autocorrect waits for the active word and checks completed words", () => {
  assert.deepEqual(autocorrectScopeAtCaret("pleasee", 7), {
    checkableText: "",
    preservedSuffix: "pleasee",
  });
  assert.deepEqual(autocorrectScopeAtCaret("can we pleasee check", 20), {
    checkableText: "can we pleasee ",
    preservedSuffix: "check",
  });
  assert.deepEqual(autocorrectScopeAtCaret("pleasee ", 8), {
    checkableText: "pleasee ",
    preservedSuffix: "",
  });
});
