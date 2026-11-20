"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { Avatar } from "./Avatar";
import { CloseIcon, SearchIcon, PlusIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from "./icons";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { groupMemberPolicy, normalizeMemberTarget, MAX_GROUP_ADDITIONS, type MemberCandidate, type MemberResult, type MemberSelection } from "@/lib/group-membership";

type Picked = { key: string; name: string; handle: string; selection: MemberSelection };
type Data = { candidates: MemberCandidate[]; groupName: string; accountLabel: string; sourceUrl: string };
const control = "rounded-lg transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-700";
const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export function AddGroupPeople({ conversationId, platform }: { conversationId: string; platform: Platform }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [conversationId]);
  return <><button type="button" onClick={() => setOpen(true)} className={`${control} flex items-center gap-1 px-1.5 py-1 text-xs font-medium text-accent`}><PlusIcon className="h-3.5 w-3.5" />Add people</button>
    <AnimatePresence>{open && <AddGroupPeopleDialog key={conversationId} conversationId={conversationId} platform={platform} onClose={() => setOpen(false)} />}</AnimatePresence></>;
}

export function AddGroupPeopleDialog({ conversationId, platform, onClose }: { conversationId: string; platform: Platform; onClose: () => void }) {
  const policy = groupMemberPolicy(platform);
  const [data, setData] = useState<Data>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Picked[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<Picked>();
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<MemberResult[]>();
  const [copied, setCopied] = useState(false);
  const submitted = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    const timer = setTimeout(() => {
      fetch(`/api/conversations/${conversationId}/participants?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load contacts."); return body; })
        .then(value => { if (!controller.signal.aborted) setData(value); })
        .catch(e => { if (!controller.signal.aborted) setLoadError(e.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [conversationId, query, retry]);

  function pick(person: Picked) {
    setError(""); setCopied(false);
    setSelected(current => current.some(p => p.key === person.key) ? current.filter(p => p.key !== person.key) : current.length < MAX_GROUP_ADDITIONS ? [...current, person] : current);
  }
  async function post(body: object) {
    const response = await fetch(`/api/conversations/${conversationId}/participants`, { method: "POST", headers: { "content-type": "application/json", "x-omni-group-action": "1" }, signal: AbortSignal.timeout(70_000), body: JSON.stringify(body) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Could not complete this action.");
    return json.result;
  }
  async function lookup() {
    if (looking) return;
    setError(""); setPreview(undefined);
    try {
      const normalized = normalizeMemberTarget(platform, target);
      if (!policy.direct) {
        setPreview({ key: `${platform}:${normalized}`, name: normalized, handle: "Entered manually · verify in the native app", selection: { target: normalized, expectedKey: `${platform}:${normalized}` } });
        return;
      }
      setLooking(true);
      const person = await post({ action: "resolve", target: normalized });
      if (alive.current) setPreview({ key: person.expectedKey, name: person.name, handle: person.handle, selection: { target: person.target, expectedKey: person.expectedKey } });
    } catch (e) { if (alive.current) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Lookup timed out. Check the connection and try again."); }
    finally { if (alive.current) setLooking(false); }
  }
  async function add() {
    if (submitted.current || !selected.length) return;
    submitted.current = true; setBusy(true); setError("");
    try {
      const result = await post({ action: "add", requestId: crypto.randomUUID(), selections: selected.map(p => p.selection) });
      if (alive.current) setResults(result);
    } catch (e) {
      if (alive.current) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Could not confirm the additions. Check membership in the native app before trying again.");
      // Keep submit disabled after an uncertain result; reopening requires an
      // explicit user decision and the backend also checks native membership.
    } finally { if (alive.current) setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(selected.map(p => "target" in p.selection ? p.selection.target : p.handle || p.key.replace(/^[^:]+:/, "")).join("\n")); setCopied(true); setError(""); }
    catch { setError("Clipboard access was blocked. Select and copy the names below."); }
  }
  const count = selected.length;
  const working = busy || looking;
  return <OverlayPortal onClose={busy ? undefined : onClose}><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 sm:p-5" onClick={() => !busy && onClose()}>
    <motion.section role="dialog" aria-modal="true" aria-labelledby="add-group-people-title" initial={{ y: 10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl dark:bg-neutral-800 dark:text-neutral-100" onClick={e => e.stopPropagation()}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-neutral-700">
        <div className="min-w-0"><h2 id="add-group-people-title" className="text-lg font-semibold">{results ? "Addition results" : "Add people"}</h2><p className="mt-1 truncate text-sm text-slate-500 dark:text-neutral-400">{data?.groupName || "Group"} <span aria-hidden>·</span> {PLATFORMS[platform].label}</p></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close add people" className={`${control} p-2`}><CloseIcon className="h-5 w-5" /></button>
      </header>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {results ? <div role="status" className="space-y-3"><p className="text-sm text-slate-500 dark:text-neutral-400">{results.filter(r => r.status === "added").length} added · {results.filter(r => r.status === "already_member").length} already members</p>{results.map((r, i) => <div key={`${r.key}-${i}`} className="rounded-xl border border-slate-200 p-3 dark:border-neutral-700"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{r.name}</strong><span className={`text-xs font-medium ${["added", "already_member"].includes(r.status) ? "text-accent" : "text-amber-700 dark:text-amber-300"}`}>{({ added: "Added", already_member: "Already a member", not_added: "Not added", unknown: "Unconfirmed" })[r.status]}</span></div><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">{r.detail}</p></div>)}</div> : <>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-neutral-400">{policy.hint}</p>
          {count > 0 && <div className="flex flex-wrap gap-2" aria-label="Selected people">{selected.map(p => <button key={p.key} type="button" disabled={working || submitted.current} onClick={() => pick(p)} aria-label={`Remove ${p.name} from selection`} className={`${control} flex max-w-full items-center gap-1.5 bg-accent/10 px-2.5 py-1.5 text-xs text-accent`}><span className="truncate">{p.name}</span><CloseIcon className="h-3 w-3 shrink-0" /></button>)}</div>}
          <div><label htmlFor="group-people-search" className="mb-2 block text-xs font-medium">{query ? "Search contacts" : "Recent contacts"}<span className="ml-1.5 font-normal text-slate-500 dark:text-neutral-400">{data ? `· ${data.accountLabel}` : ""}</span></label><div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input id="group-people-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or username" disabled={working || submitted.current} className={`${field} pl-9`} /></div></div>
          <div className="max-h-56 space-y-1 overflow-y-auto" aria-label="Recent contact choices" aria-busy={loading}>
            {loading ? <p role="status" className="py-6 text-center text-sm text-slate-500 dark:text-neutral-400">Loading contacts…</p> : loadError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError} <button type="button" className={`${control} underline`} onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !data?.candidates.length ? <p className="py-5 text-center text-sm text-slate-500 dark:text-neutral-400">{query ? "No matching contacts. Add someone manually below." : "No recent contacts for this account yet. Add someone manually below."}</p> : data.candidates.map(person => {
              const checked = selected.some(p => p.key === person.externalKey);
              return <button type="button" role="checkbox" aria-checked={checked} aria-label={person.name} key={person.id} disabled={working || submitted.current || (!checked && count >= MAX_GROUP_ADDITIONS)} onClick={() => pick({ key: person.externalKey, name: person.name, handle: person.handle, selection: { contactId: person.id } })} className={`${control} flex w-full items-center gap-3 p-2 text-left ${checked ? "bg-accent/10" : ""}`}><Avatar name={person.name} platform={platform} src={person.avatarUrl || undefined} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-slate-500 dark:text-neutral-400">{person.handle}</span></span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-accent bg-accent text-white dark:text-neutral-950" : "border-slate-300 dark:border-neutral-600"}`}>{checked && <CheckIcon className="h-3.5 w-3.5" />}</span></button>;
            })}
          </div>
          <div className="border-t border-slate-200 pt-3 dark:border-neutral-700"><button type="button" aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)} className={`${control} flex items-center gap-2 py-1 text-sm font-medium text-accent`} disabled={working || submitted.current}><PlusIcon className="h-4 w-4" />Add someone manually</button>
            {manualOpen && <div className="mt-3 space-y-3"><label htmlFor="group-person-target" className="block text-xs text-slate-500 dark:text-neutral-400">{platform === "whatsapp" ? "Phone number" : platform === "gmail" ? "Email address" : "Username"}</label><form className="flex gap-2" onSubmit={e => { e.preventDefault(); void lookup(); }}><input id="group-person-target" value={target} onChange={e => { setTarget(e.target.value); setPreview(undefined); }} placeholder={policy.placeholder} autoComplete="off" disabled={working || submitted.current} className={`${field} min-w-0 flex-1`} /><button type="submit" disabled={working || !target.trim() || submitted.current} className={`${control} shrink-0 border border-slate-200 px-3 text-sm font-medium dark:border-neutral-700`}>{looking ? "Looking…" : policy.direct ? "Look up" : "Review"}</button></form>{preview && <div className="rounded-xl border border-accent/30 bg-accent/5 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{preview.name}</p><p className="mt-1 break-words text-xs text-slate-500 dark:text-neutral-400">{preview.handle}</p></div><button type="button" disabled={working || count >= MAX_GROUP_ADDITIONS || selected.some(p => p.key === preview.key) || submitted.current} onClick={() => { pick(preview); setPreview(undefined); setTarget(""); }} className={`${control} shrink-0 px-2 py-1 text-sm font-medium text-accent`}>Select</button></div></div>}</div>}
          </div>
          {count >= MAX_GROUP_ADDITIONS && <p className="text-xs text-slate-500 dark:text-neutral-400">Add up to {MAX_GROUP_ADDITIONS} people at a time.</p>}
        </>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-relaxed text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {busy && <p role="status" className="text-sm text-slate-500 dark:text-neutral-400">Checking each person with {PLATFORMS[platform].label}… This can take up to a minute.</p>}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-neutral-700">
        {data && (!policy.direct || results || (submitted.current && !busy)) && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className={`${control} inline-flex items-center gap-1.5 px-3 py-2.5 text-sm`}>Open in {PLATFORMS[platform].label}<ExternalLinkIcon className="h-4 w-4" /></a>}
        {results || (submitted.current && !busy) ? <button type="button" onClick={onClose} className={`${control} bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent/90`}>Done</button> : policy.direct ? <button type="button" onClick={() => void add()} disabled={!count || working || !data || submitted.current} className={`${control} bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent/90`}>{busy ? "Adding people…" : `Add ${count || ""} ${count === 1 ? "person" : "people"}`}</button> : <button type="button" onClick={() => void copy()} disabled={!count} className={`${control} inline-flex items-center gap-2 bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent/90`}><CopyIcon className="h-4 w-4" />{copied ? "Copied" : `Copy ${count || ""} ${count === 1 ? "contact" : "contacts"}`}</button>}
      </footer>
    </motion.section>
  </motion.div></OverlayPortal>;
}
