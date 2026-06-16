"use client";

import { useEffect, useState } from "react";

type Entry = { version: string; date?: string; title?: string; notes?: string[] };
type Check = {
  current: string;
  latest: string;
  hasUpdate: boolean;
  entries: Entry[];
  repoUrl?: string;
  selfUpdate?: boolean;
};

export function UpdateBanner() {
  const [data, setData] = useState<Check | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/updates/check")
      .then((r) => r.json())
      .then((d: Check) => {
        if (!d?.hasUpdate) return;
        setData(d);
        setHidden(localStorage.getItem("dismissedUpdate") === d.latest);
      })
      .catch(() => {});
  }, []);

  if (!data || hidden) return null;

  function dismiss() {
    localStorage.setItem("dismissedUpdate", data!.latest);
    setHidden(true);
  }

  async function pull() {
    setApplying(true);
    setApplyMsg(null);
    try {
      const r = await fetch("/api/updates/apply", { method: "POST" });
      const d = await r.json();
      setApplyMsg(
        d.applied
          ? `✓ Pulled latest. ${d.next || ""}`
          : d.reason === "self-update-disabled"
            ? "One-click update is off — run the commands above, then restart."
            : d.error || "Update failed."
      );
    } catch {
      setApplyMsg("Couldn't reach the server.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1FE88A]/20 text-base">
          ✨
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold dark:text-neutral-100">
            Update available
          </div>
          <div className="text-xs text-slate-500 dark:text-neutral-400">
            v{data.current} →{" "}
            <b className="text-[#0e9f63] dark:text-[#1FE88A]">v{data.latest}</b>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="rounded p-1 text-slate-300 transition hover:text-slate-500 dark:text-neutral-600 dark:hover:text-neutral-400"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-slate-100 px-4 py-3 dark:border-neutral-700/70">
          {data.entries.map((e) => (
            <div key={e.version} className="mb-3 last:mb-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold dark:text-neutral-100">
                  v{e.version}
                </span>
                {e.title && (
                  <span className="text-xs text-slate-500 dark:text-neutral-400">
                    {e.title}
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5">
                {(e.notes || []).map((n, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-xs text-slate-600 dark:text-neutral-300"
                  >
                    <span className="text-[#0e9f63] dark:text-[#1FE88A]">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="mt-2 rounded-lg bg-slate-50 p-2 dark:bg-neutral-900">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              To update
            </div>
            <code className="block whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 dark:text-neutral-300">
              git pull{"\n"}npm install{"\n"}npm run build
            </code>
            <div className="mt-1 text-[10px] text-slate-400 dark:text-neutral-500">
              then restart the app + sync worker.{" "}
              {data.repoUrl && (
                <a
                  href={data.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0e9f63] hover:underline dark:text-[#1FE88A]"
                >
                  View on GitHub →
                </a>
              )}
            </div>
          </div>
          {applyMsg && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-neutral-400">
              {applyMsg}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-neutral-700/70">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {open ? "Hide" : "What's new"}
        </button>
        <div className="flex-1" />
        <button
          onClick={dismiss}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
        >
          Not now
        </button>
        <button
          onClick={() => {
            setOpen(true);
            if (data.selfUpdate) pull();
          }}
          disabled={applying}
          className="rounded-lg bg-[#1FE88A] px-3 py-1.5 text-xs font-semibold text-[#04140d] transition hover:bg-[#16d579] disabled:opacity-60"
        >
          {data.selfUpdate ? (applying ? "Pulling…" : "Update now") : "Update"}
        </button>
      </div>
    </div>
  );
}
