"use client";

import { useEffect, useState } from "react";

type Entry = {
  version: string;
  sha?: string;
  date?: string;
  title?: string;
  notes?: string[];
};
type Check = {
  current: string;
  latest: string;
  currentSha?: string | null;
  latestSha?: string | null;
  hasUpdate: boolean;
  behindCount?: number;
  branch?: string;
  canApply?: boolean;
  blockedReason?: string | null;
  entries: Entry[];
  repoUrl?: string;
  selfUpdate?: boolean;
  manualCommands?: string[];
};

export function UpdateBanner() {
  const [data, setData] = useState<Check | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = () =>
      fetch("/api/updates/check", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: Check) => {
          if (!active) return;
          if (!d?.hasUpdate) {
            setData(null);
            setHidden(true);
            return;
          }
          setData(d);
          setHidden(localStorage.getItem("dismissedUpdate") === d.latest);
        })
        .catch(() => {});
    void check();
    const interval = window.setInterval(check, 10 * 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!data || hidden) return null;

  function dismiss() {
    localStorage.setItem("dismissedUpdate", data!.latest);
    setHidden(true);
  }

  // Wait for the server to come back after its restart, then reload into the
  // new build.
  function waitForRestart() {
    setApplyMsg("Restarting…");
    const iv = setInterval(async () => {
      try {
        const r = await fetch("/api/updates/check", { cache: "no-store" });
        if (r.ok) {
          clearInterval(iv);
          location.reload();
        }
      } catch {
        /* still down */
      }
    }, 3000);
  }

  function poll() {
    const iv = setInterval(async () => {
      let s: {
        phase?: string;
        error?: string | null;
        done?: boolean;
        restarting?: boolean;
        restartRequired?: boolean;
      } | null = null;
      try {
        s = await fetch("/api/updates/apply", { cache: "no-store" }).then((r) =>
          r.json()
        );
      } catch {
        // request failed → the process is likely restarting after the build
        clearInterval(iv);
        waitForRestart();
        return;
      }
      if (s?.error) {
        clearInterval(iv);
        setApplying(false);
        setApplyMsg(`Update failed: ${s.error}`);
        return;
      }
      if (s?.restartRequired) {
        clearInterval(iv);
        setApplying(false);
        setApplyMsg("Installed. Restart OmniCRM and its sync worker to finish.");
        return;
      }
      if (s?.done || s?.restarting) {
        clearInterval(iv);
        waitForRestart();
        return;
      }
      setApplyMsg(`${s?.phase || "Working"}…`);
    }, 2000);
  }

  async function pull() {
    setApplying(true);
    setApplyMsg("Starting…");
    let start: { started?: boolean; reason?: string; error?: string } | null =
      null;
    try {
      start = await fetch("/api/updates/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-omnicrm-update": "1",
        },
        body: JSON.stringify({ expectedRevision: data?.latestSha }),
      }).then((r) => r.json());
    } catch {
      setApplying(false);
      setApplyMsg("Couldn't reach the server.");
      return;
    }
    if (!start?.started) {
      setApplying(false);
      setApplyMsg(
        start?.reason === "self-update-disabled"
          ? "One-click update is off — set ALLOW_SELF_UPDATE=1, or run the commands above."
          : start?.error || "Couldn't start the update."
      );
      return;
    }
    poll();
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/20 text-base">
          ✨
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold dark:text-neutral-100">
            {data.behindCount || 1} {(data.behindCount || 1) === 1 ? "update" : "updates"} available
          </div>
          <div className="text-xs text-slate-500 dark:text-neutral-400">
            {data.current} →{" "}
            <b className="text-accent dark:text-accent">{data.latest}</b>
            {data.branch ? ` · ${data.branch}` : ""}
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
            <div key={e.sha || e.version} className="mb-3 last:mb-0">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 dark:bg-neutral-700 dark:text-neutral-300">
                  {e.version}
                </span>
                {e.title && (
                  <span className="text-xs text-slate-500 dark:text-neutral-400">
                    {e.title}
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5 pl-1">
                {(e.notes || []).map((n, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 text-xs text-slate-600 dark:text-neutral-300"
                  >
                    <span className="text-accent dark:text-accent">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {data.blockedReason && (
            <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {data.blockedReason}
            </div>
          )}

          <div className="mt-2 rounded-lg bg-slate-50 p-2 dark:bg-neutral-900">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              To update
            </div>
            <code className="block whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 dark:text-neutral-300">
              {(data.manualCommands || ["git pull --ff-only", "npm install", "npm run build"]).join("\n")}
            </code>
            <div className="mt-1 text-[10px] text-slate-400 dark:text-neutral-500">
              then restart the app + sync worker.
              {!data.selfUpdate && (
                <span> One-click updates are available on localhost or with <code>ALLOW_SELF_UPDATE=1</code>.</span>
              )}{" "}
              {data.repoUrl && (
                <a
                  href={data.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline dark:text-accent"
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
            if (data.selfUpdate && data.canApply) pull();
          }}
          disabled={applying}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent disabled:opacity-60"
        >
          {applying
            ? "Updating…"
            : data.selfUpdate && data.canApply
              ? "Update now"
              : "View steps"}
        </button>
      </div>
    </div>
  );
}
