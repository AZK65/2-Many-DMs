"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { findNetworkPath, possibleIdentityMatches, type PeopleNetwork, type NetworkPerson } from "@/lib/people-network";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { ArrowLeftIcon, RefreshIcon, SearchIcon } from "./icons";
import { WorkspaceHeader } from "./WorkspaceHeader";
import InteractiveNetworkMap from "./InteractiveNetworkMap";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900";
const control = `rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 ${focus}`;
const platformName = (p: string) => PLATFORMS[p as Platform]?.label || p;
const chatUrl = (id: string) => `/?conversation=${encodeURIComponent(id)}`;

function personSearch(p: NetworkPerson) {
  return p.records.map(r => `${r.name} ${r.handle} ${r.email || ""} ${r.phone || ""}`).join(" ").toLowerCase();
}

export function PeopleNetworkView() {
  const [data, setData] = useState<PeopleNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [onlyGroups, setOnlyGroups] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const [neighborLimit, setNeighborLimit] = useState(30);
  const reducedMotion = useReducedMotion();

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/people-network", { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Could not load your network. Your saved chats are unchanged.");
      const network: PeopleNetwork = await response.json();
      setData(network);
      setSelectedId(current => network.people.some(p => p.id === current) ? current : network.people[0]?.id || "");
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "Could not load connections.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const abort = new AbortController(); void refresh(abort.signal); return () => abort.abort(); }, [refresh]);
  useEffect(() => { setLimit(60); }, [query, platform, onlyGroups]);
  useEffect(() => { setGroupId(""); setTargetId(""); setTargetQuery(""); setNeighborLimit(30); }, [selectedId]);
  useEffect(() => { setNeighborLimit(30); }, [groupId]);

  const peopleById = useMemo(() => new Map(data?.people.map(p => [p.id, p]) || []), [data]);
  const groupsById = useMemo(() => new Map(data?.groups.map(g => [g.id, g]) || []), [data]);
  const selected = peopleById.get(selectedId);
  const filtered = useMemo(() => (data?.people || []).filter(p =>
    (!onlyGroups || p.groupIds.length > 0) && (platform === "all" || p.platforms.includes(platform)) &&
    (!query.trim() || personSearch(p).includes(query.trim().toLowerCase()) || p.groupIds.some(id => groupsById.get(id)?.name.toLowerCase().includes(query.trim().toLowerCase())))
  ), [data, query, platform, onlyGroups, groupsById]);
  const selectedGroups = selected?.groupIds.flatMap(id => groupsById.get(id) || []) || [];
  const neighbors = useMemo(() => {
    const found = new Map<string, string[]>();
    for (const id of selected?.groupIds || []) {
      if (groupId && id !== groupId) continue;
      for (const member of groupsById.get(id)?.members || []) {
        if (member.personId === selectedId) continue;
        found.set(member.personId, [...(found.get(member.personId) || []), id]);
      }
    }
    return [...found].flatMap(([id, groups]) => peopleById.has(id) ? [{ person: peopleById.get(id)!, groups }] : [])
      .sort((a, b) => b.groups.length - a.groups.length || a.person.name.localeCompare(b.person.name));
  }, [selected, selectedId, groupId, groupsById, peopleById]);
  const matches = useMemo(() => selected && data ? possibleIdentityMatches(selected, data.people) : [], [selected, data]);
  const targets = useMemo(() => targetQuery.trim().length >= 2 ? (data?.people || []).filter(p => p.id !== selectedId && personSearch(p).includes(targetQuery.toLowerCase().trim())).slice(0, 8) : [], [targetQuery, selectedId, data]);
  const path = useMemo(() => data && selected && targetId ? findNetworkPath(data, selected.id, targetId) : null, [data, selected, targetId]);

  return <main className="workspace-page min-h-screen bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
    <WorkspaceHeader actions={<button type="button" title="Refresh network" aria-label="Refresh network" onClick={() => void refresh()} disabled={loading} className={`${control} flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-neutral-800`}><RefreshIcon className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /><span>Refresh</span></button>} />
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your people, connected.</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-neutral-400">Explore shared groups and possible introductions from saved chat history. A shared group is context—not proof of a personal relationship or current membership.</p>
      {data && <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">{data.people.length.toLocaleString()} people · {data.groups.length.toLocaleString()} groups with known participants · Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error} <button type="button" disabled={loading} onClick={() => void refresh()} className={`ml-2 rounded underline ${focus}`}>Retry</button></div>}
      {loading && !data && <div role="status" className="mt-8 rounded-xl border border-slate-200 p-8 text-sm text-slate-500 dark:border-neutral-800">Building connections from saved chats…</div>}
      {data && <InteractiveNetworkMap data={data} selectedId={selectedId} onPerson={setSelectedId} />}
      {data && <div className="mt-6 grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside aria-label="Find people" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="space-y-3 border-b border-slate-200 p-4 dark:border-neutral-800">
            <label className="relative block"><span className="sr-only">Search people, usernames, or groups</span><SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="People, usernames, groups…" className={`${control} w-full pl-9`} /></label>
            <select aria-label="Filter network by platform" value={platform} onChange={e => setPlatform(e.target.value)} className={`${control} w-full`}><option value="all">All platforms</option>{Object.entries(PLATFORMS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select>
            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-neutral-400"><input type="checkbox" checked={onlyGroups} onChange={e => setOnlyGroups(e.target.checked)} className={`accent-accent ${focus}`} /> People seen in groups only</label>
          </div>
          <div className="max-h-64 overflow-y-auto lg:max-h-[65vh]" aria-label="People">
            <p className="px-4 py-2 text-xs text-slate-400">{filtered.length.toLocaleString()} people</p>
            {!filtered.length && <p className="p-4 text-sm text-slate-500">No matches. Try a different name or include direct chats.</p>}
            {filtered.slice(0, limit).map(p => <button type="button" key={p.id} aria-pressed={selectedId === p.id} onClick={() => setSelectedId(p.id)} className={`block w-full border-l-2 px-4 py-3 text-left transition-colors ${focus} ${selectedId === p.id ? "border-accent bg-accent/10" : "border-transparent hover:bg-slate-50 dark:hover:bg-neutral-800"}`}><span className="block truncate text-sm font-medium">{p.name}</span><span className="mt-1 block truncate text-xs text-slate-500 dark:text-neutral-400">{p.platforms.map(platformName).join(" · ")} · {p.groupIds.length} groups</span></button>)}
            {filtered.length > limit && <button type="button" onClick={() => setLimit(n => n + 60)} className={`w-full p-3 text-sm text-accent ${focus}`}>Show more people</button>}
          </div>
        </aside>
        {selected ? <motion.section key={selected.id} initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="min-w-0 space-y-4" aria-label={`Connections for ${selected.name}`}>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="break-words text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{selected.groupIds.length} shared-chat groups · {neighbors.length} {groupId ? "people in selected group" : "connected people"}</p></div><div className="flex flex-wrap gap-2">{selected.directChats.map(c => <Link key={c.id} href={chatUrl(c.id)} className={`${control} text-accent hover:bg-accent/10`}>Open {platformName(c.platform)} chat</Link>)}</div></div>
            <details className="mt-4 text-sm"><summary className={`w-fit cursor-pointer rounded text-slate-500 dark:text-neutral-400 ${focus}`}>Identity details{selected.records.length > 1 ? ` · ${selected.records.length} linked records` : ""}</summary><div className="mt-3 space-y-2">{selected.records.map(r => <div key={r.id} className="break-words rounded-lg bg-slate-50 p-3 dark:bg-neutral-800"><p className="font-medium">{r.name}</p><p className="text-xs text-slate-500 dark:text-neutral-400">{[r.externalKey?.split(":")[0] && platformName(r.externalKey.split(":")[0]), r.externalKey?.includes("@lid") && r.handle.startsWith("+") ? "WhatsApp member ID (not a phone number)" : r.handle, r.email, r.phone].filter(Boolean).join(" · ")}</p></div>)}{selected.matchReasons.length > 0 && <p className="text-xs text-slate-500">Combined for this view: {selected.matchReasons.join("; ")}. Original contacts are unchanged.</p>}</div></details>
            {matches.length > 0 && <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30"><summary className={`cursor-pointer rounded font-medium text-amber-800 dark:text-amber-200 ${focus}`}>{matches.length} same-name {matches.length === 1 ? "match" : "matches"} to double-check</summary><p className="mt-2 text-xs text-amber-800 dark:text-amber-200">Possibly the same person. Name alone isn’t enough to combine their connections; check usernames and chat evidence below.</p><div className="mt-2 space-y-2">{matches.slice(0, 20).map(m => <button key={m.person.id} type="button" onClick={() => setSelectedId(m.person.id)} className={`block w-full rounded-lg bg-white/70 p-3 text-left hover:bg-white dark:bg-neutral-900 dark:hover:bg-neutral-800 ${focus}`}><span className="font-medium">{m.person.name}</span><span className="block text-xs text-slate-500 dark:text-neutral-400">{m.person.platforms.map(platformName).join(" · ")} · {m.person.records.map(r => r.handle).join(" / ")}</span><span className="block text-xs text-amber-700 dark:text-amber-300">{m.shared} groups in common{m.sameHandle ? " · Username also matches; verify platform identity" : " · No verified identity match"}</span></button>)}</div>{matches.length > 20 && <p className="mt-2 text-xs">Showing 20 candidates. Search this name to see all.</p>}</details>}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="font-semibold">Find an introduction path</h3><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Search another person to find up to three shared-group steps. Nothing is sent.</p>
            <input aria-label="Find a connection to another person" value={targetQuery} onChange={e => { setTargetQuery(e.target.value); setTargetId(""); }} placeholder="Who do you want to connect with?" className={`${control} mt-3 w-full`} />
            {!targetId && targets.length > 0 && <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-neutral-700">{targets.map(p => <button key={p.id} type="button" onClick={() => { setTargetId(p.id); setTargetQuery(p.name); }} className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-neutral-800 ${focus}`}>{p.name}<span className="ml-2 text-xs text-slate-500">{p.platforms.map(platformName).join(" · ")} · {p.records[0]?.handle}</span></button>)}</div>}
            {!targetId && targetQuery.trim().length >= 2 && !targets.length && <p className="mt-3 text-sm text-slate-500">No matching person in saved chats.</p>}
            {targetId && <div role="status" className="mt-4">{path ? <><p className="mb-3 text-xs text-slate-500">Possible route via shared chats—confirm the relationship before asking for an introduction.</p><ol className="space-y-2"><li className="text-sm font-semibold">{selected.name}</li>{path.map(step => <li key={`${step.groupId}:${step.personId}`} className="border-l-2 border-accent/30 pl-4"><Link className={`rounded text-xs text-accent hover:underline ${focus}`} href={chatUrl(groupsById.get(step.groupId)!.conversationId)}>via {groupsById.get(step.groupId)!.name}</Link><button type="button" onClick={() => setSelectedId(step.personId)} className={`mt-1 block rounded text-sm font-medium hover:text-accent ${focus}`}>{peopleById.get(step.personId)?.name}</button></li>)}</ol></> : <p className="text-sm text-slate-500 dark:text-neutral-400">No route found within three groups in saved history. Missing history or silent members may hide a connection.</p>}</div>}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"><h3 className="font-semibold">Groups seen in</h3><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Based on messages they sent, not a live membership list.</p><div className="mt-3 max-h-96 space-y-2 overflow-y-auto">{!selectedGroups.length && <p className="py-4 text-sm text-slate-500">No group participation found yet. Direct chats are available above.</p>}{selectedGroups.map(g => <div key={g.id} className={`rounded-xl border p-3 ${groupId === g.id ? "border-accent bg-accent/5" : "border-slate-200 dark:border-neutral-800"}`}><button type="button" onClick={() => setGroupId(groupId === g.id ? "" : g.id)} aria-pressed={groupId === g.id} className={`w-full rounded text-left text-sm font-medium hover:text-accent ${focus}`}>{g.name}</button><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{platformName(g.platform)} · {g.members.length} known people · Last seen {new Date(g.members.find(m => m.personId === selectedId)!.lastSeen).toLocaleDateString()}</p><Link href={chatUrl(g.conversationId)} className={`mt-2 inline-block rounded text-xs font-medium text-accent hover:underline ${focus}`}>Open group chat</Link></div>)}</div></section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{groupId ? "People in this group" : "Connected people"}</h3>{groupId && <button type="button" onClick={() => setGroupId("")} className={`rounded text-xs text-accent ${focus}`}>Clear group</button>}</div><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Ranked by shared groups, not relationship strength.</p><div className="mt-3 max-h-96 space-y-1 overflow-y-auto">{!neighbors.length && <p className="py-4 text-sm text-slate-500">No other identified participants in saved history.</p>}{neighbors.slice(0, neighborLimit).map(n => <button key={n.person.id} type="button" onClick={() => setSelectedId(n.person.id)} className={`block w-full rounded-xl p-3 text-left hover:bg-slate-50 dark:hover:bg-neutral-800 ${focus}`}><span className="block text-sm font-medium">{n.person.name}</span><span className="mt-1 block text-xs text-slate-500 dark:text-neutral-400">{n.groups.length} shared {n.groups.length === 1 ? "group" : "groups"} · {n.groups.slice(0, 3).map(id => groupsById.get(id)?.name).join(", ")}{n.groups.length > 3 ? ` +${n.groups.length - 3} more` : ""}</span></button>)}{neighbors.length > neighborLimit && <button type="button" onClick={() => setNeighborLimit(n => n + 30)} className={`w-full p-3 text-sm text-accent ${focus}`}>Show more connections</button>}</div></section>
          </div>
        </motion.section> : <section className="rounded-xl border border-slate-200 p-8 text-sm text-slate-500 dark:border-neutral-800">No people found in saved chats. Connect a platform and sync messages to build your network.</section>}
      </div>}
    </div>
  </main>;
}
