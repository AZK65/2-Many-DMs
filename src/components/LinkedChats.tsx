"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { RelationDTO } from "@/lib/types";
import type { RelationCandidate, RelationCandidatePage } from "@/lib/relation-candidates";
import { PLATFORMS } from "@/lib/platforms";
import { Avatar } from "./Avatar";
import { CloseIcon, PlusIcon, SearchIcon } from "./icons";

const control = "rounded-md p-2 text-xs font-medium transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:hover:bg-neutral-800";

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not update linked chats. Please retry.");
  return data as T;
}

function reason(item: RelationCandidate) {
  if (item.reason === "same-contact") return "Same saved contact";
  const names = item.sharedMembers.slice(0, 2).map(member => member.name).join(", ");
  const more = item.sharedCount > 2 ? ` +${item.sharedCount - 2}` : "";
  if (item.reason === "member-direct") return `Member’s direct chat · ${names}`;
  if (item.sharedCount) return `Seen in both · ${names}${more}`;
  if (item.matchedMemberNames.length) return `Member match · ${item.matchedMemberNames.join(", ")}`;
  return item.email || item.handle;
}

function LinkedRow({ relation, readOnly, busy, onOpen, onRemove, onLabel }: {
  relation: RelationDTO; readOnly: boolean; busy: boolean;
  onOpen: () => void; onRemove: () => void; onLabel: (label: string) => void;
}) {
  const [label, setLabel] = useState(relation.label || "");
  useEffect(() => setLabel(relation.label || ""), [relation.label]);
  return <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 dark:bg-neutral-800/50">
    <Avatar name={relation.contactName} platform={relation.platform} src={relation.avatarUrl} size="xs" />
    <div className="min-w-0 flex-1"><button type="button" onClick={onOpen} aria-label={`Open linked chat ${relation.contactName}`} className="block w-full rounded text-left text-sm font-medium text-slate-800 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-100"><span className="block truncate">{relation.contactName}</span></button>
      {readOnly ? <p className="mt-1 truncate text-xs text-slate-400">{relation.label || PLATFORMS[relation.platform].label}</p> : <input aria-label={`Label for ${relation.contactName}`} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} onBlur={() => { if (label.trim() !== (relation.label || "")) onLabel(label.trim()); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} maxLength={120} placeholder="Add a relationship label…" className="mt-1 w-full rounded bg-transparent text-xs text-slate-500 outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 dark:text-neutral-400" />}
    </div>
    {!readOnly && <button type="button" disabled={busy} aria-label={`Unlink ${relation.contactName}`} onClick={onRemove} className={`${control} shrink-0 text-slate-400`}><CloseIcon className="h-3.5 w-3.5" /></button>}
  </div>;
}

export function LinkedChats({ contactId, conversationId, onOpen, readOnly = false }: {
  contactId: string; conversationId: string; onOpen: (id: string) => void; readOnly?: boolean;
}) {
  const reduced = useReducedMotion();
  const [relations, setRelations] = useState<RelationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "suggested">("suggested");
  const [page, setPage] = useState<RelationCandidatePage | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [searching, setSearching] = useState(true);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/contacts/${encodeURIComponent(contactId)}/relations`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    json<RelationDTO[]>(endpoint, { signal: controller.signal }).then(data => {
      if (!Array.isArray(data)) throw new Error("Could not load linked chats.");
      if (!controller.signal.aborted) setRelations(data);
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setSearching(true); setCandidateError(null);
    if (offset === 0) setPage(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ conversationId, scope: picker ? scope : "suggested", q: picker ? query : "", offset: String(offset) });
      json<RelationCandidatePage>(`${endpoint}/candidates?${params}`, { signal: controller.signal }).then(data => {
        if (!Array.isArray(data.items)) throw new Error("Could not find related chats.");
        if (!controller.signal.aborted) setPage(current => offset > 0 && current ? { ...data, items: [...current.items, ...data.items].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index) } : data);
      }).catch(error => { if (!controller.signal.aborted) setCandidateError(error.message); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [endpoint, conversationId, picker, scope, query, offset, refresh]);

  function resetSearch() { setOffset(0); setPage(null); }
  function closePicker() { setPicker(false); setQuery(""); setScope("suggested"); resetSearch(); trigger.current?.focus(); }
  async function mutate(key: string, method: string, body?: object, relationId?: string) {
    if (busy || readOnly) return;
    setBusy(key); setActionError(null);
    try {
      const result = await json<RelationDTO>(`${endpoint}${relationId ? `?id=${encodeURIComponent(relationId)}` : ""}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (method === "DELETE") setRelations(current => current.filter(item => item.id !== relationId));
      else setRelations(current => [...current.filter(item => item.id !== result.id), result]);
      resetSearch(); setRefresh(value => value + 1);
    } catch (error) { setActionError(error instanceof Error ? error.message : "Could not save this link."); }
    finally { setBusy(null); }
  }
  const linked = new Set(relations.map(item => item.conversationId));
  const candidates = (page?.items || []).filter(item => !linked.has(item.id));
  const visible = picker ? candidates : candidates.slice(0, 3);

  return <section aria-label="Linked chats" className="border-b border-slate-100 px-6 py-4 dark:border-neutral-800" onKeyDown={event => { if (picker && event.key === "Escape") { event.stopPropagation(); closePicker(); } }}>
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Linked chats <span className="ml-1 text-xs font-normal text-slate-400">{relations.length || ""}</span></h3>{!readOnly && <button ref={trigger} type="button" aria-label={picker ? "Close chat linking" : "Add linked chat"} aria-expanded={picker} onClick={() => { if (picker) closePicker(); else { setPicker(true); setScope("all"); resetSearch(); } }} className={`${control} text-accent`}>{picker ? "Done" : "+ Add"}</button>}</div>
    {loading && <p role="status" className="py-2 text-xs text-slate-400">Loading linked chats…</p>}
    {loadError && <p role="alert" className="py-2 text-xs text-red-600 dark:text-red-400">{loadError}<button type="button" onClick={() => setRefresh(value => value + 1)} className={`${control} ml-1`}>Retry</button></p>}
    {actionError && <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
    {!loading && !loadError && !relations.length && <p className="mb-3 text-xs text-slate-400">No saved links yet. Link a chat below to keep it here.</p>}
    <div className="space-y-2">{relations.map(relation => <LinkedRow key={relation.id} relation={relation} readOnly={readOnly} busy={!!busy} onOpen={() => onOpen(relation.conversationId)} onRemove={() => void mutate(relation.id, "DELETE", undefined, relation.id)} onLabel={label => void mutate(relation.id, "PATCH", { id: relation.id, label })} />)}</div>

    <motion.div layout="position" transition={{ duration: reduced ? 0 : 0.2 }} className="mt-4">
      {picker ? <div className="mb-3 space-y-3">
        <label className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 focus-within:ring-2 focus-within:ring-accent dark:bg-neutral-800"><SearchIcon className="h-4 w-4 shrink-0 text-slate-400" /><input autoFocus maxLength={200} aria-label="Search chats or group members to link" placeholder="Name, email, phone, or group…" value={query} onChange={event => { setQuery(event.target.value); resetSearch(); }} className="min-w-0 w-full bg-transparent text-xs outline-none dark:text-neutral-100" /></label>
        <div className="flex gap-2" aria-label="Linked chat search scope">{(["suggested", "all"] as const).map(value => <button key={value} type="button" aria-pressed={scope === value} onClick={() => { setScope(value); resetSearch(); }} className={`${control} flex-1 ${scope === value ? "bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-white" : "text-slate-400"}`}>{value === "suggested" ? "Shared people" : "All chats"}</button>)}</div>
      </div> : <h4 className="mb-2 text-xs font-medium text-slate-500 dark:text-neutral-400">Suggested chats</h4>}
      <p className="mb-3 text-xs leading-5 text-slate-400">Based on people seen in synced messages, not a complete or current member list. Links are saved only when you add them.</p>
      {searching && <div role="status" className="space-y-2 py-2"><span className="sr-only">Finding chats…</span><div className="h-8 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-neutral-800" /><div className="h-8 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-neutral-800" /></div>}
      {candidateError && <p role="alert" className="py-2 text-xs text-red-600 dark:text-red-400">{candidateError}<button type="button" onClick={() => setRefresh(value => value + 1)} className={`${control} ml-1`}>Retry search</button></p>}
      {!searching && !candidateError && !visible.length && <p role="status" className="py-2 text-xs text-slate-400">{query ? "No matching chats. Try another name or email." : picker && scope === "all" ? "No more chats to link." : "No shared-member matches yet. Use + Add to find any chat manually."}</p>}
      <div className={`${picker ? "max-h-80 overflow-y-auto" : ""} space-y-2`}>
        {visible.map(item => <div key={item.id} className="flex items-start gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-neutral-800/50">
          <button type="button" onClick={() => onOpen(item.id)} aria-label={`Open suggested chat ${item.name}`} className="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <Avatar name={item.name} platform={item.platform} size="xs" src={item.avatarUrl} group={item.isGroup && item.sharedCount ? { count: item.sharedCount, members: item.sharedMembers } : undefined} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{item.name}</span><span className="mt-1 block text-xs text-slate-400">{PLATFORMS[item.platform].label} · {item.isGroup ? "Group" : "Direct"}{item.archived ? " · Archived" : item.hidden ? " · Hidden" : ""}</span><span className="mt-1 block break-words text-xs leading-5 text-slate-500 dark:text-neutral-400">{reason(item)}</span>{item.accountLabel && <span className="mt-1 block truncate text-xs text-slate-400">via {item.accountLabel}</span>}</span>
          </button>
          {!readOnly && <button type="button" disabled={!!busy || loading || !!loadError} aria-label={`Link ${item.name}`} title={`Link ${item.name}`} onClick={() => void mutate(item.id, "POST", { targetConversationId: item.id })} className={`${control} shrink-0 text-accent`}>{busy === item.id ? <span>Saving…</span> : <PlusIcon className="h-4 w-4" />}</button>}
        </div>)}
      </div>
      {!searching && !candidateError && !picker && (page?.total || 0) > 3 && <button type="button" onClick={() => { setPicker(true); setScope("suggested"); resetSearch(); }} className={`${control} mt-2 w-full text-accent`}>See all {page!.total} suggestions</button>}
      {picker && page?.nextOffset !== null && page?.nextOffset !== undefined && <button type="button" disabled={searching} onClick={() => setOffset(page.nextOffset!)} className={`${control} mt-2 w-full text-accent`}>Show more chats</button>}
    </motion.div>
  </section>;
}
