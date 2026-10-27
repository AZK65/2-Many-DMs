import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, loadSettings, loadStages } from "./settings";
import { PIPELINE } from "./pipeline";

test("standalone defaults expose generic deal stages and safe notification defaults", () => {
  assert.deepEqual(PIPELINE.map((stage) => stage.id), ["lead", "contacted", "negotiating", "won", "lost"]);
  assert.equal(DEFAULT_SETTINGS.notifications, false);
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS.plugins), ["calcom"]);
});

test("custom board stages and partially saved settings survive an upgrade", () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stages = [{ id: "demo", name: "Demo booked", color: "#3b82f6" }];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => JSON.stringify({ stages, plugins: { calcom: { enabled: true } } }) },
  });
  try {
    assert.deepEqual(loadStages(), stages);
    assert.deepEqual(loadSettings().plugins.calcom, { enabled: true, link: "" });
    assert.equal(loadSettings().notifications, false);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage); else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
