"use client";

import { useEffect, useState } from "react";

export type ChangeEntry = { version: string; date?: string; title?: string; notes?: string[] };

export function ChangelogList({ entries }: { entries?: ChangeEntry[] }) {
  const [fetched, setFetched] = useState<ChangeEntry[]>([]);
  const [loading, setLoading] = useState(!entries);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (entries) return;
    const controller = new AbortController();
    setLoading(true); setError(false);
    fetch("/changelog.json", { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Could not load releases"); return response.json(); })
      .then(data => {
        if (!Array.isArray(data.entries)) throw new Error("Invalid release list");
        setFetched(data.entries.filter((entry: ChangeEntry) => typeof entry.version === "string"));
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [entries, attempt]);
  if (!entries && loading) return <div role="status" aria-label="Loading releases" className="space-y-8 motion-safe:animate-pulse">{[0, 1, 2].map(index => <div key={index} className="rounded-xl bg-slate-100 p-8 dark:bg-neutral-900"><div className="h-6 w-1/3 rounded bg-slate-200 dark:bg-neutral-800" /><div className="mt-6 h-4 w-4/5 rounded bg-slate-200 dark:bg-neutral-800" /><div className="mt-4 h-4 w-3/5 rounded bg-slate-200 dark:bg-neutral-800" /></div>)}</div>;
  if (!entries && error) return <div role="alert" className="rounded-xl bg-slate-100 p-8 dark:bg-neutral-900"><h2 className="text-xl font-medium">The updates couldn’t load.</h2><p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">Check your connection and try again.</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="marketing-primary mt-6">Retry loading updates</button></div>;
  const list = entries ?? fetched;
  if (!list.length) return <p role="status" className="py-12 text-slate-500 dark:text-neutral-400">No releases have been published yet.</p>;
  return <div>{list.map(entry => <article key={entry.version} className="grid gap-6 border-t border-slate-200 py-12 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-12 dark:border-neutral-800">
    <div><span className="text-lg font-medium text-accent">v{entry.version}</span>{entry.date && <time dateTime={entry.date} className="mt-2 block text-xs text-slate-500 dark:text-neutral-400">{entry.date}</time>}</div>
    <div><h2 className="text-2xl font-medium tracking-tight">{entry.title || `Release ${entry.version}`}</h2><ul className="mt-6 space-y-4">{(entry.notes || []).map((note, index) => <li key={index} className="flex gap-3 text-sm leading-relaxed text-slate-500 dark:text-neutral-400"><span aria-hidden className="text-accent">↗</span><span>{note}</span></li>)}</ul></div>
  </article>)}</div>;
}
