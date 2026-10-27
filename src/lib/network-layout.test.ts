import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutNetwork, fitNetwork, zoomCamera } from "./network-layout";
import type { PeopleNetwork } from "./people-network";

const data: PeopleNetwork = {
  generatedAt: "", sourceContacts: 4,
  people: ["a", "b", "c", "d"].map(id => ({ id, name: id, records: [], platforms: [], directChats: [], matchReasons: [], groupIds: id === "a" ? ["g1"] : id === "b" ? ["g1", "g2"] : id === "c" ? ["g2"] : [] })),
  groups: [{ id: "g1", name: "First", platform: "telegram", conversationId: "1", members: ["a", "b"].map(personId => ({ personId, lastSeen: "" })) }, { id: "g2", name: "Second", platform: "whatsapp", conversationId: "2", members: ["b", "c"].map(personId => ({ personId, lastSeen: "" })) }],
};
test("focused layout includes every shared group participant but no invented edges", () => {
  const layout = layoutNetwork(data, "a", false);
  assert.deepEqual(layout.nodes.map(n => n.id).sort(), ["g:g1", "p:a", "p:b"]);
  assert.equal(layout.edges.length, 2);
  assert.equal(layout.nodes.find(n => n.id === "p:a")!.x, 0);
});
test("whole network includes isolated direct contacts and all group edges", () => {
  const layout = layoutNetwork(data, "a", true);
  assert.equal(layout.nodes.length, 6);
  assert.equal(layout.edges.length, 4);
  assert.ok(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.deepEqual(layoutNetwork(data, "a", true), layout);
});
test("fit places all nodes inside the viewport", () => {
  const layout = layoutNetwork(data, "a", true);
  const camera = fitNetwork(layout.nodes, 390, 600);
  for (const n of layout.nodes) {
    assert.ok(n.x * camera.zoom + camera.x >= 0 && n.x * camera.zoom + camera.x <= 390);
    assert.ok(n.y * camera.zoom + camera.y >= 0 && n.y * camera.zoom + camera.y <= 600);
  }
});
test("zoom keeps the world point under the cursor fixed", () => {
  const camera = { x: 20, y: 10, zoom: 0.5 }, point = { x: 210, y: 85 };
  const next = zoomCamera(camera, 1.4, point);
  assert.equal((point.x - camera.x) / camera.zoom, (point.x - next.x) / next.zoom);
  assert.equal((point.y - camera.y) / camera.zoom, (point.y - next.y) / next.zoom);
});
test("zoom has safe limits and empty maps fit", () => {
  assert.equal(zoomCamera({ x: 0, y: 0, zoom: 1 }, 100, { x: 0, y: 0 }).zoom, 4);
  assert.equal(zoomCamera({ x: 0, y: 0, zoom: 1 }, 0.00001, { x: 0, y: 0 }).zoom, 0.005);
  assert.deepEqual(fitNetwork([], 400, 600), { x: 200, y: 300, zoom: 1 });
});
