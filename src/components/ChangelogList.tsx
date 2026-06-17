"use client";

import { useEffect, useState } from "react";

export type ChangeEntry = {
  version: string;
  date?: string;
  title?: string;
  notes?: string[];
};

// Renders the changelog as a timeline. Pass `entries` to avoid a fetch, or
// leave it out to load /changelog.json itself.
export function ChangelogList({ entries }: { entries?: ChangeEntry[] }) {
  const [fetched, setFetched] = useState<ChangeEntry[]>([]);
  useEffect(() => {
    if (entries) return;
    fetch("/changelog.json")
      .then((r) => r.json())
      .then((d) => setFetched(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => {});
  }, [entries]);

  const list = entries ?? fetched;
  if (!list.length) return null;

  return (
    <div className="space-y-9 border-l border-slate-200 pl-6 dark:border-neutral-800">
      {list.map((e) => (
        <div key={e.version} className="relative">
          <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-accent ring-4 ring-white dark:ring-black" />
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-sm font-bold text-accent">
              v{e.version}
            </span>
            {e.title && (
              <span className="font-semibold dark:text-neutral-100">{e.title}</span>
            )}
            {e.date && (
              <span className="text-xs text-slate-400 dark:text-neutral-500">
                {e.date}
              </span>
            )}
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {(e.notes || []).map((n, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-slate-600 dark:text-neutral-300"
              >
                <span className="mt-px text-accent">•</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
