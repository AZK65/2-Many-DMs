"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloseIcon, SearchIcon } from "./icons";

type SearchResult = {
  id: string;
  body: string;
  direction: string;
  senderName: string | null;
  createdAt: string;
  matchSource: "image" | "message";
};

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!pattern) return <>{text}</>;
  return <>{text.split(new RegExp(`(${pattern})`, "gi")).map((part, index) =>
    tokens.some((token) => token.toLowerCase() === part.toLowerCase())
      ? <mark key={index} className="rounded bg-accent/20 text-inherit">{part}</mark>
      : part,
  )}</>;
}

export function ChatSearch({ conversationId, name, onSelect }: {
  conversationId: string;
  name: string;
  onSelect: (id: string, signal: AbortSignal) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingImages, setPendingImages] = useState(0);
  const [jumping, setJumping] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const jumpController = useRef<AbortController | null>(null);
  const term = query.trim();

  function close() {
    setOpen(false);
    jumpController.current?.abort();
    setJumping(null);
    trigger.current?.focus();
  }

  useEffect(() => () => jumpController.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        jumpController.current?.abort();
        setJumping(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (!open || term.length < 2) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, conversationId, offset: String(offset) });
        const response = await fetch(`/api/messages/search?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Search is unavailable. Please try again.");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setResults((previous) => offset ? [...previous, ...data.results.filter((item: SearchResult) => !previous.some((old) => old.id === item.id))] : data.results);
        setHasMore(data.hasMore);
        setPendingImages(data.pendingImageCount);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, term, conversationId, offset, retry]);

  async function select(id: string) {
    jumpController.current?.abort();
    const controller = new AbortController();
    jumpController.current = controller;
    setJumping(id);
    setError("");
    try {
      await onSelect(id, controller.signal);
      if (!controller.signal.aborted) close();
    } catch {
      if (!controller.signal.aborted) setError("Couldn’t open that message. Please try again.");
    } finally {
      if (!controller.signal.aborted) setJumping(null);
    }
  }

  return <div ref={root} className="shrink-0" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" aria-label="Search this chat" title="Search this chat" aria-expanded={open}
      onClick={() => open ? close() : setOpen(true)}
      className={`grid h-9 w-9 place-items-center rounded-lg transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800 ${open ? "bg-accent/10 text-accent" : "text-slate-500 dark:text-neutral-400"}`}>
      <SearchIcon className="h-4 w-4" />
    </button>
    <AnimatePresence>{open && <motion.section aria-label="Search this conversation" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
      className="absolute inset-x-3 top-full z-40 mt-2 ml-auto max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="border-b border-slate-100 p-3 dark:border-neutral-800">
        <div className="mb-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-500 dark:text-neutral-400">Search in {name}</p>
          <button type="button" onClick={close} aria-label="Close chat search" className="rounded p-1 text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800"><CloseIcon className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 dark:border-neutral-700 dark:bg-neutral-800">
          <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <input autoFocus aria-label="Search messages in this chat" placeholder="Search messages…" value={query} maxLength={120}
            onChange={(event) => { jumpController.current?.abort(); setJumping(null); setQuery(event.target.value); setOffset(0); setResults([]); setError(""); setHasMore(false); setPendingImages(0); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !loading && !jumping && results[0]) { event.preventDefault(); void select(results[0].id); } }}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-neutral-100" />
        </div>
      </div>
      <div className="max-h-[min(50vh,24rem)] overflow-y-auto overscroll-contain p-2" aria-busy={loading || !!jumping}>
        <p role="status" className="px-2 py-2 text-xs text-slate-500 dark:text-neutral-400">
          {term.length < 2 ? "Type at least 2 characters. Searches synced messages and indexed image text." : loading && !results.length ? "Searching this chat…" : !results.length && !error ? "No matches in this chat. Try another word or phrase." : `${results.length}${hasMore ? "+" : ""} matches · newest first`}
        </p>
        {results.map((result) => <button key={result.id} type="button" disabled={!!jumping} onClick={() => void select(result.id)}
          className="block w-full rounded-lg p-3 text-left transition hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-60">
          <span className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-neutral-400">
            <span className="truncate font-semibold">{jumping === result.id ? "Opening…" : result.direction === "out" ? "You" : result.senderName || name}</span>
            <time className="shrink-0" dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time>
          </span>
          {result.matchSource === "image" && <span className="text-[11px] font-medium text-accent">Text in image · </span>}
          <span className="break-words text-sm leading-5 text-slate-800 dark:text-neutral-200"><Highlight text={result.body} query={term} /></span>
        </button>)}
        {error && <div role="alert" className="px-2 py-2 text-xs text-red-600 dark:text-red-400">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="rounded underline focus-visible:ring-2 focus-visible:ring-accent">Retry search</button></div>}
        {hasMore && !error && <button type="button" disabled={loading || !!jumping} onClick={() => setOffset((value) => value + 40)} className="w-full rounded-lg py-2 text-xs font-semibold text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">{loading ? "Loading…" : "Show older matches"}</button>}
        {pendingImages > 0 && <p className="px-2 py-2 text-[11px] text-slate-400">Some images in this chat aren’t indexed yet.</p>}
      </div>
    </motion.section>}</AnimatePresence>
  </div>;
}
