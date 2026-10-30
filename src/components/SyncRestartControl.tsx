"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { CheckIcon, CloseIcon, RefreshIcon } from "./icons";
import { syncHealthView, type SyncHealth } from "@/lib/sync-health";
import { WorkspaceMenu } from "./WorkspaceMenu";

type RestartPhase =
  | "idle"
  | "stopping"
  | "starting"
  | "connecting"
  | "ready"
  | "attention"
  | "error";

type RestartLog = {
  at: string;
  message: string;
  tone: "normal" | "success" | "warning" | "error";
};

type PlatformStatus = {
  platform: string;
  state: "starting" | "qr" | "ready" | "disconnected" | "disabled";
  detail?: string;
  sync?: SyncHealth;
};

type RestartSnapshot = {
  ok: boolean;
  runId: string | null;
  phase: RestartPhase;
  startedAt: string | null;
  finishedAt: string | null;
  pid: number | null;
  logs: RestartLog[];
  platforms: Record<string, PlatformStatus>;
  running: boolean;
  error?: string;
};

const EMPTY_SNAPSHOT: RestartSnapshot = {
  ok: true,
  runId: null,
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  pid: null,
  logs: [],
  platforms: {},
  running: false,
};

const ACTIVE_PHASES: RestartPhase[] = ["stopping", "starting", "connecting"];

function logTime(value: string): string {
  if (Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function phaseTitle(phase: RestartPhase): string {
  if (phase === "stopping") return "Stopping sync";
  if (phase === "starting") return "Launching sync";
  if (phase === "connecting") return "Connecting accounts";
  if (phase === "ready") return "Sync launched";
  if (phase === "attention") return "Sync needs attention";
  if (phase === "error") return "Restart failed";
  return "Restart sync";
}

function statusLabel(status: PlatformStatus): string {
  if (status.state === "ready") return "Connected";
  if (status.state === "qr") return "Scan QR";
  if (status.state === "disconnected") return "Needs attention";
  if (status.state === "disabled") return "Not running";
  return "Connecting";
}

export function SyncRestartControl({
  onOpenSettings,
  expandedBrand = false,
}: {
  onOpenSettings: () => void;
  expandedBrand?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Main workspace");
  const [customWorkspace, setCustomWorkspace] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/workspaces/identity", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const value = await response.json();
      if (!controller.signal.aborted) { setWorkspaceName(value.name); setCustomWorkspace(value.id !== "default"); }
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<RestartSnapshot>(EMPTY_SNAPSHOT);
  const [requesting, setRequesting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const active = requesting || ACTIVE_PHASES.includes(snapshot.phase);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function loadSnapshot(): Promise<RestartSnapshot | null> {
    try {
      const response = await fetch("/api/worker/restart", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const next = (await response.json()) as RestartSnapshot;
      if (!response.ok || !next.ok) throw new Error("Status unavailable");
      setSnapshot(next);
      return next;
    } catch {
      setSnapshot((previous) => ({ ...previous, platforms: {} }));
      return null;
    }
  }

  async function restart() {
    if (active) {
      setOpen(true);
      return;
    }
    setOpen(true);
    setRequesting(true);
    try {
      const response = await fetch("/api/worker/restart", { method: "POST" });
      const next = (await response.json().catch(() => ({}))) as Partial<RestartSnapshot>;
      if (!response.ok || !next.ok) {
        setSnapshot({
          ...EMPTY_SNAPSHOT,
          phase: "error",
          logs: [{
            at: new Date().toISOString(),
            message: next.error || "Omni could not start the restart.",
            tone: "error",
          }],
        });
        return;
      }
      setSnapshot(next as RestartSnapshot);
    } catch {
      setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        logs: [{
          at: new Date().toISOString(),
          message: "Omni could not reach the local restart service.",
          tone: "error",
        }],
      });
    } finally {
      setRequesting(false);
    }
  }

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try { await loadSnapshot(); } finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), open ? 4000 : 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, active, snapshot.runId]);

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [snapshot.logs.length]);

  const visiblePlatforms = Object.values(snapshot.platforms).filter(
    (platform) => platform.state !== "disabled",
  );
  const statusPhase: RestartPhase = active ? snapshot.phase
    : visiblePlatforms.length && visiblePlatforms.every(platform => platform.state === "ready" && !["attention", "progress"].includes(syncHealthView(platform).tone)) ? "ready"
    : "attention";
  const hasRestartDetails = open;

  return (
    <div className="relative shrink-0">
      <motion.button
        ref={triggerRef}
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((current) => !current)}
        title={`${workspaceName} · Workspaces and sync`}
        aria-label="Omni CRM controls"
        aria-expanded={open}
        className={`relative shrink-0 rounded-lg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${expandedBrand ? "workspace-brand" : ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {customWorkspace ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent/10 text-xs font-semibold text-accent" role="img" aria-label={workspaceName}>{workspaceName.slice(0, 2).toUpperCase()}</span> : <img src="/brand/icon-light.png" alt="Omni CRM" className="h-6 w-6 dark:hidden" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!customWorkspace && <img src="/brand/icon-dark.png" alt="" className="hidden h-6 w-6 dark:block" />}
        {expandedBrand && <span className="max-w-40 truncate">{customWorkspace ? workspaceName : <>omni<span className="ml-1 font-normal text-slate-400">crm</span></>}</span>}
        <span
          className={`sync-status-dot ${expandedBrand ? "ml-1" : "absolute -right-0.5 -top-0.5"} h-2 w-2 rounded-full ring-2 ring-white dark:ring-neutral-900 ${
            statusPhase === "ready"
              ? "bg-emerald-500"
              : statusPhase === "error" || statusPhase === "attention"
                ? "bg-amber-500"
                : active
                  ? "bg-accent"
                  : "bg-slate-300 dark:bg-neutral-600"
          }`}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
              aria-label="Close sync restart details"
            />
            <motion.section
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className="absolute left-0 top-full z-40 mt-2 max-h-[80dvh] w-72 overflow-y-auto rounded-xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-700"
              aria-label="Sync restart progress"
            >
              <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 dark:bg-[#272727]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand/icon-light.png" alt="" className="h-5 w-5 dark:hidden" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand/icon-dark.png" alt="" className="hidden h-5 w-5 dark:block" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                      {workspaceName}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-neutral-400">
                      Workspaces, settings, and sync
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-[#272727] dark:hover:text-neutral-200"
                  aria-label="Close sync restart details"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </header>

              <WorkspaceMenu onName={setWorkspaceName} />
              <div className="space-y-1 px-2 pb-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-[#272727]"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-neutral-100">Settings</span>
                    <span className="block text-xs text-slate-500 dark:text-neutral-400">Accounts, connections, and preferences</span>
                  </span>
                  <span className="text-sm text-slate-400 dark:text-neutral-500">›</span>
                </button>
                <button
                  type="button"
                  onClick={() => void restart()}
                  disabled={active}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default dark:hover:bg-[#272727]"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-neutral-100">
                      {active ? "Restarting sync" : "Restart sync"}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-neutral-400">Reconnect Telegram, WhatsApp, and X</span>
                  </span>
                  <motion.span
                    animate={active ? { rotate: 360 } : { rotate: 0 }}
                    transition={active
                      ? { duration: 1.2, repeat: Infinity, ease: "linear" }
                      : { duration: 0.3 }}
                    className={active ? "text-accent" : "text-slate-400 dark:text-neutral-500"}
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </motion.span>
                </button>
              </div>

              {hasRestartDetails && (
                <div className="border-t border-slate-100 pt-3 dark:border-neutral-800">
                  <div className="flex items-start gap-2 px-4 pb-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        statusPhase === "ready"
                          ? "bg-emerald-500"
                          : statusPhase === "error"
                            ? "bg-red-500"
                            : statusPhase === "attention"
                              ? "bg-amber-500"
                              : "bg-accent"
                      }`}
                    />
                    <div>
                      <h3 className="text-xs font-semibold text-slate-800 dark:text-neutral-100">
                        {active ? phaseTitle(snapshot.phase) : "Live connections"}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                        {active
                          ? "Keep working. Omni will reconnect in the background."
                          : statusPhase === "ready"
                            ? "Connections and message coverage are shown separately."
                            : visiblePlatforms.length ? "Some messages may be delayed. Review each platform below." : "Live status is unavailable. Check the sync service."}
                      </p>
                    </div>
                  </div>

                  {visiblePlatforms.length > 0 && (
                    <div className="space-y-2 px-4 pb-3">
                  {visiblePlatforms.slice(0, 3).map((platform) => {
                    const key = platform.platform as Platform;
                    const meta = PLATFORMS[key];
                    return (
                      <div
                        key={platform.platform}
                        className="min-w-0 rounded-lg bg-slate-50 p-2 dark:bg-[#1F1F1F]"
                      >
                        <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700 dark:text-neutral-200">{meta?.label || platform.platform}</p>
                        <span className="text-xs text-slate-500 dark:text-neutral-400">{statusLabel(platform)}</span>
                        </div>
                        <p className={`mt-1 text-xs font-medium ${
                          syncHealthView(platform).tone === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : ["attention", "progress"].includes(syncHealthView(platform).tone)
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-slate-400 dark:text-neutral-500"
                        }`}>
                          {syncHealthView(platform).label}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-neutral-400">{syncHealthView(platform).detail}</p>
                        {platform.sync?.lastCheckedAt ? <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Last inbox check: {new Date(platform.sync.lastCheckedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
                        {platform.sync?.lastMessageAt ? <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Last message saved: {new Date(platform.sync.lastMessageAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
                        {platform.sync?.retryAt && platform.sync.retryAt > Date.now() ? <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Retry after {new Date(platform.sync.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
                      </div>
                    );
                  })}
                    </div>
                  )}

                  {snapshot.logs.length > 0 && <div
                    ref={logRef}
                    className="max-h-48 space-y-2 overflow-y-auto border-y border-slate-100 bg-slate-50 px-4 py-3 dark:border-neutral-800 dark:bg-[#1F1F1F]"
                  >
                    {snapshot.logs.map((entry, index) => (
                  <div key={`${entry.at}-${index}`} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      entry.tone === "success"
                        ? "bg-emerald-500"
                        : entry.tone === "warning"
                          ? "bg-amber-500"
                          : entry.tone === "error"
                            ? "bg-red-500"
                            : "bg-slate-300 dark:bg-neutral-600"
                    }`} />
                    <span className="min-w-0 flex-1 leading-5 text-slate-600 dark:text-neutral-300">
                      {entry.message}
                    </span>
                    <time className="shrink-0 tabular-nums text-slate-400 dark:text-neutral-500">
                      {logTime(entry.at)}
                    </time>
                  </div>
                    ))}
                  </div>}

                  <footer className="p-3">
                    {statusPhase === "ready" ? (
                      <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <CheckIcon className="h-3.5 w-3.5" />
                        Connections ready
                      </div>
                    ) : statusPhase === "error" || statusPhase === "attention" ? (
                      <div className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        Connected does not mean history is complete
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-500 dark:text-neutral-400">
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                        >
                          <RefreshIcon className="h-3.5 w-3.5" />
                        </motion.span>
                        Restart in progress
                      </div>
                    )}
                  </footer>
                </div>
              )}
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
