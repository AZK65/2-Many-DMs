import test from "node:test";
import assert from "node:assert/strict";
import { initials } from "./platforms";

test("avatar initials skip group separators and never split emoji", () => {
  assert.equal(initials("Team x Alpha Vault"), "TA");
  assert.equal(initials("Aurora / Team"), "AT");
  assert.equal(initials("PandaStreams 🚀 · Topic"), "PT");
  assert.equal(initials("‎‪Nick & +1 (913)"), "N1");
  assert.equal(initials("X"), "X");
  assert.equal(initials("🧑‍🚀"), "?");
  assert.equal(initials("Émile Živko"), "ÉŽ");
});
