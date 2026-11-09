"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { GlobeIcon } from "./icons";

type XPostPreview = { authorName: string; text: string };
type PreviewState =
  | { kind: "loading" }
  | { kind: "ready"; preview: XPostPreview }
  | { kind: "error" };

export function XPostCard({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [state, setState] = useState<PreviewState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Preview unavailable");
        if (!controller.signal.aborted) setState({ kind: "ready", preview: data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [url]);

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
      onClick={onOpen}
      aria-label="Open shared X post inside 2 Many DMs"
      title="Open shared X post inside 2 Many DMs"
      className="mb-1 block w-full min-w-56 max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white text-left text-slate-900 shadow-sm transition hover:border-accent/40 hover:bg-slate-50 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-white/10 dark:bg-white/[0.045] dark:text-white dark:shadow-none dark:hover:border-accent/50 dark:hover:bg-white/[0.07]"
    >
      <span className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 dark:border-white/[0.07]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black text-[11px] font-bold text-white dark:bg-white dark:text-black">X</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">
            {state.kind === "ready" ? state.preview.authorName : "Shared X post"}
          </span>
          <span className="block text-[11px] text-slate-500 dark:text-neutral-400">
            {state.kind === "error" ? "Preview unavailable" : "Open inside 2 Many DMs"}
          </span>
        </span>
        <GlobeIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-neutral-500" />
      </span>

      {state.kind === "loading" ? (
        <span className="block space-y-2 px-3 py-3" role="status" aria-label="Loading shared X post">
          <span className="block h-2.5 w-full animate-pulse rounded bg-slate-200 dark:bg-white/10" />
          <span className="block h-2.5 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
          <span className="block h-2.5 w-2/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        </span>
      ) : state.kind === "ready" ? (
        <span className="line-clamp-4 block whitespace-pre-wrap px-3 py-3 text-[13px] leading-5 text-slate-700 dark:text-neutral-200">
          {state.preview.text}
        </span>
      ) : (
        <span className="block px-3 py-3 text-xs leading-5 text-slate-500 dark:text-neutral-400">
          X did not return this post, but you can still open its link here.
        </span>
      )}
    </motion.button>
  );
}
