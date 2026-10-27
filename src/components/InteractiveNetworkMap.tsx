"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PeopleNetwork } from "@/lib/people-network";
import { fitNetwork, layoutNetwork, zoomCamera, type MapCamera, type MapNode } from "@/lib/network-layout";

const button = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800";

export default function InteractiveNetworkMap({ data, selectedId, onPerson }: {
  data: PeopleNetwork; selectedId: string; onPerson: (id: string) => void;
}) {
  const [overview, setOverview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [camera, setCamera] = useState<MapCamera>({ x: 500, y: 300, zoom: 0.1 });
  const [theme, setTheme] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const section = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const cameraRef = useRef(camera);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const helpId = useId();
  const layout = useMemo(() => layoutNetwork(data, selectedId, overview), [data, selectedId, overview]);
  const nodes = useMemo(() => new Map(layout.nodes.map(n => [n.id, n])), [layout]);
  const selected = data.people.find(p => p.id === selectedId);
  const group = data.groups.find(g => `g:${g.id}` === activeGroup);
  const results = useMemo(() => query.trim().length > 1 ? data.people.filter(p => p.records.some(r => `${r.name} ${r.handle} ${r.email || ""}`.toLowerCase().includes(query.toLowerCase().trim()))).slice(0, 8) : [], [data, query]);
  const updateCamera = useCallback((next: MapCamera) => { cameraRef.current = next; setCamera(next); }, []);
  const fit = useCallback(() => updateCamera(fitNetwork(layout.nodes, size.width, size.height)), [layout, size, updateCamera]);
  useEffect(() => { fit(); setActiveGroup(null); setHovered(null); }, [fit]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    const themeObserver = new MutationObserver(() => setTheme(n => n + 1));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => { observer.disconnect(); themeObserver.disconnect(); };
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    canvas.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setExpanded(false); expandButton.current?.focus(); }
      if (e.key === "Tab") {
        const controls = section.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], canvas[tabindex]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", escape); };
  }, [expanded]);

  const zoom = useCallback((factor: number, point = { x: size.width / 2, y: size.height / 2 }) => updateCamera(zoomCamera(cameraRef.current, factor, point)), [size, updateCamera]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoom(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.006), { x: e.clientX - box.left, y: e.clientY - box.top });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom]);

  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const frame = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = size.width * dpr; el.height = size.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const styles = getComputedStyle(el);
      const ink = styles.color, accent = `rgb(${styles.getPropertyValue("--accent-rgb").trim()})`;
      const dark = document.documentElement.classList.contains("dark");
      const background = dark ? "#181818" : "#ffffff";
      ctx.fillStyle = background; ctx.fillRect(0, 0, size.width, size.height);
      const xy = (n: MapNode) => ({ x: n.x * camera.zoom + camera.x, y: n.y * camera.zoom + camera.y });
      const highlight = hovered || activeGroup || `p:${selectedId}`;
      for (const edge of layout.edges) {
        const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
        const p = xy(a), q = xy(b), active = edge.from === highlight || edge.to === highlight;
        ctx.globalAlpha = active ? 0.65 : 0.1; ctx.strokeStyle = active ? accent : ink; ctx.lineWidth = active ? 1.5 : 0.6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const labelled: { x: number; y: number; width: number }[] = [];
      const ordered = [...layout.nodes].sort((a, b) => Number(b.id === highlight) - Number(a.id === highlight) || Number(b.kind === "group") - Number(a.kind === "group"));
      for (const n of ordered) {
        const p = xy(n);
        if (p.x < -100 || p.x > size.width + 100 || p.y < -30 || p.y > size.height + 30) continue;
        const active = n.id === highlight || n.id === `p:${selectedId}`;
        const r = active ? 8 : n.kind === "group" ? 5 : Math.max(2, Math.min(5, camera.zoom * 8));
        ctx.fillStyle = n.kind === "group" || active ? accent : ink;
        ctx.globalAlpha = active || n.kind === "group" ? 1 : 0.65;
        ctx.beginPath();
        if (n.kind === "group") ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill(); ctx.globalAlpha = 1;
        if (active || camera.zoom > 0.5 || (n.kind === "group" && camera.zoom > 0.035)) {
          ctx.font = `${active ? 600 : 400} 12px ${styles.fontFamily}`;
          const label = n.label.length > 38 ? `${n.label.slice(0, 36)}…` : n.label;
          const width = ctx.measureText(label).width + 12;
          const pos = { x: p.x + r + 6, y: p.y - 8, width };
          if (active || !labelled.some(l => Math.abs(l.y - pos.y) < 20 && l.x < pos.x + width && l.x + l.width > pos.x)) {
            ctx.fillStyle = background; ctx.globalAlpha = 0.9; ctx.fillRect(pos.x - 2, pos.y - 2, width, 20); ctx.globalAlpha = 1;
            ctx.fillStyle = ink; ctx.fillText(label, pos.x + 4, pos.y + 12); labelled.push(pos);
          }
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, nodes, camera, size, hovered, activeGroup, selectedId, theme]);

  function point(e: { clientX: number; clientY: number }) {
    const box = canvas.current!.getBoundingClientRect(); return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
  function hit(p: { x: number; y: number }) {
    let best: MapNode | null = null, distance = 12;
    for (const node of layout.nodes) {
      const d = Math.hypot(node.x * cameraRef.current.zoom + cameraRef.current.x - p.x, node.y * cameraRef.current.zoom + cameraRef.current.y - p.y);
      if (d < distance) { best = node; distance = d; }
    }
    return best;
  }
  function choose(node: MapNode | null) {
    if (node?.kind === "person") { onPerson(node.id.slice(2)); setOverview(false); setActiveGroup(null); }
    else setActiveGroup(node?.id || null);
  }

  return <section ref={section} aria-label="Interactive connection map" role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined} className={`${expanded ? "fixed inset-0 z-50 flex flex-col" : "mt-6 overflow-hidden rounded-2xl border border-slate-200 dark:border-neutral-800"} bg-white dark:bg-neutral-900`}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-neutral-800">
      <div className="relative min-w-0 flex-1 basis-48"><input aria-label="Find a person on the map" placeholder="Find a person on the map…" value={query} onChange={e => setQuery(e.target.value)} className={`${button} w-full font-normal`} />
        {query.trim().length > 1 && <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">{results.length ? results.map(p => <button type="button" key={p.id} onClick={() => { onPerson(p.id); setOverview(false); setQuery(""); }} className={`${button} block w-full border-0 text-left`}>{p.name}<span className="block text-xs font-normal text-slate-500 dark:text-neutral-400">{p.platforms.join(" · ")} · {p.groupIds.length} groups</span></button>) : <p className="p-3 text-sm text-slate-500">No matching people.</p>}</div>}
      </div>
      <button type="button" className={button} aria-pressed={overview} onClick={() => setOverview(v => !v)}>{overview ? "Show selected person" : "Whole network"}</button>
      <button type="button" className={button} aria-label="Zoom out" disabled={camera.zoom <= 0.005} onClick={() => zoom(1 / 1.4)}>−</button>
      <output aria-label="Map zoom" className="w-12 text-center text-xs tabular-nums">{Math.round(camera.zoom * 100)}%</output>
      <button type="button" className={button} aria-label="Zoom in" disabled={camera.zoom >= 4} onClick={() => zoom(1.4)}>+</button>
      <button type="button" className={button} onClick={fit}>Fit</button>
      <button type="button" ref={expandButton} className={button} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? "Close expanded map" : "Expand"}</button>
    </div>
    <div className={`relative min-h-0 ${expanded ? "flex-1" : "h-[70dvh] min-h-96"}`}>
      <canvas ref={canvas} tabIndex={0} role="img" aria-label="Zoomable network of people and shared groups" aria-describedby={helpId} className="h-full w-full touch-none text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:text-neutral-300" style={{ cursor: hovered ? "pointer" : "grab" }}
        onKeyDown={e => {
          if (["+", "=", "-", "0", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
          if (e.key === "+" || e.key === "=") zoom(1.4);
          if (e.key === "-") zoom(1 / 1.4);
          if (e.key === "0") fit();
          const delta = { ArrowUp: [0, 64], ArrowDown: [0, -64], ArrowLeft: [64, 0], ArrowRight: [-64, 0] }[e.key];
          if (delta) updateCamera({ ...cameraRef.current, x: cameraRef.current.x + delta[0], y: cameraRef.current.y + delta[1] });
        }}
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); pointers.current.set(e.pointerId, p); gesture.current = { ...p, moved: pointers.current.size > 1 }; }}
        onPointerMove={e => {
          const p = point(e), previous = pointers.current.get(e.pointerId);
          if (!previous) { setHovered(hit(p)?.id || null); return; }
          const before = [...pointers.current.values()]; pointers.current.set(e.pointerId, p); const after = [...pointers.current.values()];
          if (Math.hypot(p.x - gesture.current.x, p.y - gesture.current.y) > 4) gesture.current.moved = true;
          if (before.length === 2) {
            gesture.current.moved = true;
            const midpoint = (ps: typeof before) => ({ x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 });
            const a = midpoint(before), b = midpoint(after);
            const distance = (ps: typeof before) => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
            const next = zoomCamera(cameraRef.current, distance(after) / Math.max(1, distance(before)), a);
            updateCamera({ ...next, x: next.x + b.x - a.x, y: next.y + b.y - a.y });
          } else updateCamera({ ...cameraRef.current, x: cameraRef.current.x + p.x - previous.x, y: cameraRef.current.y + p.y - previous.y });
        }}
        onPointerUp={e => { if (!pointers.current.has(e.pointerId)) return; pointers.current.delete(e.pointerId); e.currentTarget.releasePointerCapture(e.pointerId); if (!gesture.current.moved) choose(hit(point(e))); }}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); gesture.current.moved = true; }}
        onLostPointerCapture={e => { pointers.current.delete(e.pointerId); }}
        onPointerLeave={() => setHovered(null)}
      />
      {!layout.nodes.length && <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-slate-500 dark:text-neutral-400">No saved connections to map yet. Sync chats to get started.</p>}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2 text-xs">
        <div className="pointer-events-auto max-w-sm rounded-lg border border-slate-200 bg-white/95 p-3 dark:border-neutral-700 dark:bg-neutral-900/95"><p className="font-semibold">{group?.name || (overview ? "Whole network" : selected?.name)}</p><p className="mt-1 text-slate-500 dark:text-neutral-400">{group ? `${group.members.length} known participants` : `${layout.nodes.length.toLocaleString()} nodes · ${layout.edges.length.toLocaleString()} shared group links`}</p>{group && <Link className="mt-2 inline-block text-accent underline" href={`/?conversation=${encodeURIComponent(group.conversationId)}`}>Open group chat</Link>}</div>
        <p className="rounded-lg bg-white/95 p-2 text-slate-500 dark:bg-neutral-900/95 dark:text-neutral-400">● People · ■ Groups</p>
      </div>
    </div>
    <p id={helpId} className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-neutral-800 dark:text-neutral-400">Scroll or pinch to zoom · Drag to move · Click a node to explore. Keyboard: + / − zoom, arrows move, 0 fits. Search or use the people list below for accessible navigation. Lines show shared chats, not confirmed friendships.</p>
  </section>;
}
