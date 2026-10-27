import type { PeopleNetwork } from "./people-network";

export type MapNode = { id: string; kind: "person" | "group"; label: string; x: number; y: number; count: number };
export type NetworkLayout = { nodes: MapNode[]; edges: { from: string; to: string }[] };

// Static, deterministic clustering: no continuously running force simulation.
// Spatial proximity is a layout choice; only the drawn edges imply shared chats.
export function layoutNetwork(data: PeopleNetwork, selectedId: string, overview: boolean): NetworkLayout {
  const selected = data.people.find(p => p.id === selectedId);
  const groupIds = new Set(selected?.groupIds || []);
  const groups = data.groups.filter(g => overview || groupIds.has(g.id))
    .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  const nodes: MapNode[] = [];
  const edges: NetworkLayout["edges"] = [];
  const positions = new Map<string, { x: number; y: number; count: number }>();
  const seen = new Set<string>();
  const people = new Map(data.people.map(p => [p.id, p]));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  groups.forEach((g, i) => {
    const radius = 800 * Math.sqrt(i + 1);
    const x = Math.cos(i * goldenAngle) * radius;
    const y = Math.sin(i * goldenAngle) * radius;
    nodes.push({ id: `g:${g.id}`, kind: "group", label: g.name, x, y, count: g.members.length });
    positions.set(g.id, { x, y, count: 0 });
    for (const m of g.members) {
      if (!people.has(m.personId)) continue;
      edges.push({ from: `p:${m.personId}`, to: `g:${g.id}` });
      seen.add(m.personId);
    }
  });
  if (selected) seen.add(selected.id);
  if (overview) data.people.forEach(p => seen.add(p.id));
  let isolated = 0;
  for (const id of [...seen].sort()) {
    const p = people.get(id)!;
    // Place each person in their largest visible group, retaining all other edges.
    const group = groups.find(g => p.groupIds.includes(g.id));
    const hub = group && positions.get(group.id);
    let x = 0, y = 0;
    if (p.id !== selectedId || overview) {
      if (hub) {
        const index = hub.count++;
        const radius = 48 + 24 * Math.sqrt(index + 1);
        x = hub.x + Math.cos(index * goldenAngle) * radius;
        y = hub.y + Math.sin(index * goldenAngle) * radius;
      } else {
        const index = isolated++;
        x = -1200 - 48 * (index % 40);
        y = -800 - 48 * Math.floor(index / 40);
      }
    }
    nodes.push({ id: `p:${p.id}`, kind: "person", label: p.name, x, y, count: p.groupIds.length });
  }
  return { nodes, edges };
}

export type MapCamera = { x: number; y: number; zoom: number };
export function zoomCamera(camera: MapCamera, factor: number, point: { x: number; y: number }): MapCamera {
  const zoom = Math.min(4, Math.max(0.005, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return { x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio, zoom };
}

export function fitNetwork(nodes: MapNode[], width: number, height: number): MapCamera {
  if (!nodes.length) return { x: width / 2, y: height / 2, zoom: 1 };
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const zoom = Math.min(1, Math.max(0.005, Math.min(Math.max(1, width - 96) / Math.max(160, right - left), Math.max(1, height - 96) / Math.max(160, bottom - top))));
  return { x: width / 2 - (left + right) / 2 * zoom, y: height / 2 - (top + bottom) / 2 * zoom, zoom };
}
