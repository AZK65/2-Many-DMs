"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { CheckIcon, CloseIcon, DownloadIcon, ExternalLinkIcon } from "./icons";

export type UpdateCheck = {
  current: string;
  latest: string;
  currentSha?: string | null;
  latestSha?: string | null;
  hasUpdate: boolean;
  behindCount?: number;
  branch?: string;
  canApply?: boolean;
  blockedReason?: string | null;
  entries: { version: string; sha?: string; date?: string; title?: string; notes?: string[] }[];
  repoUrl?: string;
  selfUpdate?: boolean;
  manualCommands?: string[];
};

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-neutral-900";

export function UpdateDialog({ data, preview = false, applying = false, installed = false, message, onClose, onUpdate }: {
  data: UpdateCheck;
  preview?: boolean;
  applying?: boolean;
  installed?: boolean;
  message?: string | null;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [manual, setManual] = useState(false);
  const manualRef = useRef<HTMLDetailsElement>(null);
  const reduceMotion = useReducedMotion();
  const canInstall = !preview && !installed && data.hasUpdate && data.selfUpdate && data.canApply && !!data.latestSha;
  const transition = { duration: reduceMotion ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] as const };
  useEffect(() => {
    if (manual) manualRef.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [manual, reduceMotion]);

  return <OverlayPortal onClose={applying ? undefined : onClose}>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => { if (!applying) onClose(); }}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 16, scale: reduceMotion ? 1 : 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }} transition={transition}
        onClick={event => event.stopPropagation()}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl dark:bg-[#1F1F1F] dark:text-neutral-100">
        <header className="shrink-0 px-6 pb-6 pt-6 sm:px-8 sm:pt-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent/10 text-accent"><DownloadIcon className="h-6 w-6" /></span>
              <div className="text-sm font-medium text-slate-500 dark:text-neutral-400">
                {preview ? "Update preview" : installed ? "Installation complete" : applying ? "Update in progress" : "Ready when you are"}
                <span className="mt-1 block text-xs">{preview ? "Latest release notes" : "A new version of your workspace"}</span>
              </div>
            </div>
            <button type="button" aria-label={preview ? "Close update preview" : "Close update notification"} disabled={applying} onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors duration-200 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <h2 id={titleId} className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{installed ? "Your update is installed" : applying ? "Updating your workspace" : "A new update is available"}</h2>
          <p id={descriptionId} className="mt-2 text-pretty text-sm leading-relaxed text-slate-500 dark:text-neutral-400">
            {preview ? "This is a preview of the update window. Nothing will be installed from this view."
              : installed ? "Restart the app and sync worker to start using the new version."
              : applying ? "Keep this window open. We’ll show progress here and reload when the new build is ready."
                : "See what’s changed, then choose when to install. The app may restart during the update."}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-slate-50 px-4 py-3 text-xs dark:bg-neutral-900">
            {!preview && <><span className="text-slate-500 dark:text-neutral-400">Installed <code className="ml-1 text-slate-700 dark:text-neutral-300">{data.current}</code></span><span aria-hidden="true" className="text-slate-400">→</span></>}
            <span className="font-medium text-slate-800 dark:text-neutral-100">{preview ? "Release" : installed ? "Updated to" : "Available"} <code className="ml-1">{data.latest}</code></span>
            {!preview && !!data.behindCount && <span className="ml-auto text-slate-500 dark:text-neutral-400">{data.behindCount} {data.behindCount === 1 ? "change" : "changes"}</span>}
          </div>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-slate-100 px-6 py-6 sm:px-8 dark:border-neutral-800">
          <h3 className="mb-4 text-sm font-semibold">What’s new</h3>
          <div className="space-y-6">
            {data.entries.length ? data.entries.map(entry => <article key={entry.sha || entry.version}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h4 className="text-base font-medium text-slate-900 dark:text-neutral-100">{entry.title || "Workspace improvements"}</h4>
                {entry.date && <time dateTime={entry.date} className="text-xs text-slate-500 dark:text-neutral-400">{entry.date}</time>}
              </div>
              {!!entry.notes?.length && <ul className="mt-3 space-y-3">{entry.notes.map((note, index) => <li key={index} className="flex gap-3 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-accent" /><span>{note}</span>
              </li>)}</ul>}
            </article>) : <p className="text-sm text-slate-500 dark:text-neutral-400">This update has no detailed release notes. Review the changes on GitHub before installing.</p>}
          </div>
          {!preview && data.blockedReason && <p role="status" className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{data.blockedReason}</p>}
          {!preview && !installed && <details ref={manualRef} open={manual} onToggle={event => setManual(event.currentTarget.open)} className="mt-6 text-sm">
            <summary className="cursor-pointer rounded-lg py-2 text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400">Manual installation steps</summary>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:bg-neutral-900 dark:text-neutral-300"><code>{(data.manualCommands || ["git pull --ff-only", "npm install", "npm run build"]).join("\n")}</code></pre>
            <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">Then restart the app and sync worker.{!data.selfUpdate && " One-click installation is disabled on this server."}</p>
            {data.repoUrl && <a href={data.repoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded text-sm text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">Review on GitHub <ExternalLinkIcon className="h-4 w-4" /></a>}
          </details>}
        </div>

        <footer className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8 dark:border-neutral-800 dark:bg-neutral-900/50">
          {message && <p role="status" aria-live="polite" className="mb-4 text-sm text-slate-600 dark:text-neutral-300">{message}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a href="/changelog" target="_blank" rel="noreferrer" className={`${button} mr-auto text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white`}>Full changelog <ExternalLinkIcon className="h-4 w-4" /></a>
            {!preview && !installed && <button type="button" disabled={applying} onClick={onClose} className={`${button} text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800`}>Not now</button>}
            <button type="button" disabled={applying} onClick={preview || installed ? onClose : canInstall ? onUpdate : () => setManual(true)}
              className={`${button} bg-accent text-accent-fg hover:brightness-95`}>
              {!preview && !installed && <DownloadIcon className="h-4 w-4" />}{preview ? "Close preview" : installed ? "Done" : applying ? "Updating…" : canInstall ? "Update now" : "View steps"}
            </button>
          </div>
        </footer>
      </motion.section>
    </motion.div>
  </OverlayPortal>;
}
