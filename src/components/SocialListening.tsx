"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { cardDateTime, listTime } from "@/lib/time";
import {
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  ZapIcon,
} from "./icons";

type Lead = {
  id: string;
  postId: string;
  watcher: string | null;
  username: string;
  displayName: string | null;
  bio: string | null;
  followers: string | null;
  content: string;
  url: string;
  matchedQuery: string | null;
  tier: "HOT" | "WARM" | "REJECT";
  reason: string | null;
  status: "new" | "contacted" | "ignored";
  rating: "good" | "bad" | null;
  postedAt: string | null;
  receivedAt: string;
  repliedAt: string | null;
  replyText: string | null;
  kind: "lead" | "support";
};

type ReplyQuota = { sessionReady: boolean; cap: number; usedToday: number; remaining: number };

type Watcher = { name: string; chatId: string; queries: string[] };

type Feed = {
  leads: Lead[];
  counts: { hot: number; warm: number; rejected: number; support: number; supportNew: number };
  lastRun: { createdAt: string; found: number; hot: number; warm: number } | null;
};

type SupportBackfill = {
  state: "idle" | "running" | "complete" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  found: number;
  imported: number;
  error: string | null;
};

/**
 * The tier colours the whole card rather than a badge, so triage reads at a
 * glance from across the room. Rose/amber/neutral is semantic and deliberately
 * separate from the app's green accent, which stays reserved for chrome.
 * Body copy takes a hue-biased near-black so the tint looks chosen, not washed.
 */
const TIER = {
  HOT: {
    label: "Hot",
    card: "border-rose-200/80 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30",
    label_: "text-rose-700 dark:text-rose-300",
    avatar: "bg-rose-200/80 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
    name: "text-rose-950 dark:text-rose-50",
    body: "text-rose-950/90 dark:text-rose-100/90",
    muted: "text-rose-900/50 dark:text-rose-200/45",
    rule: "border-rose-200/70 dark:border-rose-900/40",
    chip: "bg-white/70 text-rose-900 hover:bg-white dark:bg-white/10 dark:text-rose-100 dark:hover:bg-white/15",
  },
  WARM: {
    label: "Warm",
    card: "border-amber-200/80 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
    label_: "text-amber-700 dark:text-amber-300",
    avatar: "bg-amber-200/80 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
    name: "text-amber-950 dark:text-amber-50",
    body: "text-amber-950/90 dark:text-amber-100/90",
    muted: "text-amber-900/50 dark:text-amber-200/45",
    rule: "border-amber-200/70 dark:border-amber-900/40",
    chip: "bg-white/70 text-amber-900 hover:bg-white dark:bg-white/10 dark:text-amber-100 dark:hover:bg-white/15",
  },
  REJECT: {
    label: "Filtered",
    card: "border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
    label_: "text-slate-400 dark:text-neutral-500",
    avatar: "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400",
    name: "text-slate-600 dark:text-neutral-300",
    body: "text-slate-500 dark:text-neutral-400",
    muted: "text-slate-400 dark:text-neutral-500",
    rule: "border-slate-100 dark:border-neutral-800",
    chip: "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700",
  },
} as const;

function XLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "bg-white text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
          : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

export function SocialListening() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<"all" | "HOT" | "WARM" | "REJECT">("HOT");
  const [status, setStatus] = useState<"all" | "new" | "contacted" | "ignored">("new");
  const [view, setView] = useState<"opportunities" | "support">("opportunities");
  const [query, setQuery] = useState("");
  const [showWatchers, setShowWatchers] = useState(false);
  const [quota, setQuota] = useState<ReplyQuota | null>(null);
  const [backfill, setBackfill] = useState<SupportBackfill | null>(null);

  const loadQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/listening/reply-quota");
      if (res.ok) setQuota(await res.json());
    } catch {
      /* quota is advisory; the server enforces it regardless */
    }
  }, []);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      tier: view === "support" ? "all" : tier,
      status,
      kind: view === "support" ? "support" : "lead",
    });
    if (query.trim()) params.set("q", query.trim());
    try {
      const res = await fetch(`/api/listening/leads?${params}`);
      if (res.ok) setFeed(await res.json());
    } finally {
      setLoading(false);
    }
  }, [tier, status, query, view]);

  useEffect(() => {
    load();
  }, [load]);

  const loadBackfill = useCallback(async () => {
    try {
      const res = await fetch("/api/listening/support-backfill", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read backfill status.");
      setBackfill(data);
      return data as SupportBackfill;
    } catch (error) {
      const failed: SupportBackfill = {
        state: "error",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        found: 0,
        imported: 0,
        error: (error as Error).message,
      };
      setBackfill(failed);
      return failed;
    }
  }, []);

  useEffect(() => {
    if (view !== "support") return;
    void loadBackfill();
  }, [view, loadBackfill]);

  useEffect(() => {
    if (view !== "support" || backfill?.state !== "running") return;
    const timer = window.setInterval(async () => {
      const next = await loadBackfill();
      if (next.state !== "running") void load();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [view, backfill?.state, loadBackfill, load]);

  async function startSupportBackfill() {
    setBackfill({
      state: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      found: 0,
      imported: 0,
      error: null,
    });
    try {
      const res = await fetch("/api/listening/support-backfill", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The 30 day backfill could not start.");
      setBackfill(data);
    } catch (error) {
      setBackfill({
        state: "error",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        found: 0,
        imported: 0,
        error: (error as Error).message,
      });
    }
  }

  // The listener runs on a cron, so the feed is never live — poll gently.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setFeed((f) =>
      f ? { ...f, leads: f.leads.map((l) => (l.id === id ? { ...l, ...body } as Lead : l)) } : f
    );
    await fetch(`/api/listening/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function erase(lead: Lead) {
    if (!confirm(`Erase @${lead.username}'s lead from the CRM?\n\nRemember to also run:\nnpm run purge -- --user @${lead.username}\nin the listener project — it keeps its own copy.`)) return;
    setFeed((f) => (f ? { ...f, leads: f.leads.filter((l) => l.id !== lead.id) } : f));
    await fetch(`/api/listening/leads/${lead.id}`, { method: "DELETE" });
  }

  const staleness = useMemo(() => {
    if (!feed?.lastRun) return null;
    const hours = (Date.now() - new Date(feed.lastRun.createdAt).getTime()) / 3600000;
    return { hours, stale: hours > 6 };
  }, [feed]);

  return (
    <div className="workspace-page flex h-dvh flex-col bg-slate-100 dark:bg-neutral-950">
      <WorkspaceHeader />

      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-5 py-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
                Social listening
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                {feed
                  ? view === "support"
                    ? `${feed.counts.supportNew} need attention · ${feed.counts.support} total support mentions`
                    : `${feed.counts.hot} hot · ${feed.counts.warm} warm · ${feed.counts.rejected} filtered out`
                  : "Loading…"}
              </p>
            </div>
            {view === "support" ? (
              <button
                onClick={startSupportBackfill}
                disabled={backfill?.state === "running"}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${backfill?.state === "running" ? "animate-spin" : ""}`} />
                {backfill?.state === "running" ? "Checking 30 days…" : "Backfill 30 days"}
              </button>
            ) : (
              <button
                onClick={() => setShowWatchers(true)}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] dark:bg-white dark:text-neutral-900"
              >
                <ZapIcon className="h-3.5 w-3.5" />
                Watchers
              </button>
            )}
          </div>

          <div className="mb-4 inline-flex items-center rounded-lg bg-slate-200/70 p-0.5 dark:bg-neutral-800">
            <Pill active={view === "opportunities"} onClick={() => setView("opportunities")}>
              Opportunities
            </Pill>
            <Pill active={view === "support"} onClick={() => setView("support")}>
              Support{feed?.counts.supportNew ? ` · ${feed.counts.supportNew}` : ""}
            </Pill>
          </div>

          {/* A dead scraper looks exactly like a quiet day unless you say so. */}
          {staleness?.stale && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <ClockIcon className="h-3.5 w-3.5 shrink-0" />
              No run received in {Math.round(staleness.hours)}h. The listener may be down,
              or its scraping quota may be exhausted.
            </div>
          )}

          {view === "support" && backfill && backfill.state !== "idle" && (
            <div
              className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                backfill.state === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                  : "border-slate-200 bg-white text-slate-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              <RefreshIcon className={`h-3.5 w-3.5 shrink-0 ${backfill.state === "running" ? "animate-spin" : ""}`} />
              {backfill.state === "running"
                ? "Scanning the previous 30 days. You can leave this page while it runs."
                : backfill.state === "complete"
                  ? `Backfill complete · ${backfill.found} found · ${backfill.imported} added or refreshed`
                  : backfill.error || "The support backfill failed."}
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {view === "opportunities" && (
              <div className="flex items-center rounded-lg bg-slate-200/70 p-0.5 dark:bg-neutral-800">
                {(["HOT", "WARM", "all", "REJECT"] as const).map((t) => (
                  <Pill key={t} active={tier === t} onClick={() => setTier(t)}>
                    {t === "all" ? "All" : TIER[t].label}
                  </Pill>
                ))}
              </div>
            )}
            <div className="flex items-center rounded-lg bg-slate-200/70 p-0.5 dark:bg-neutral-800">
              {(["new", "contacted", "ignored", "all"] as const).map((s) => (
                <Pill key={s} active={status === s} onClick={() => setStatus(s)}>
                  {s[0].toUpperCase() + s.slice(1)}
                </Pill>
              ))}
            </div>
            <div className="relative ml-auto">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-40 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-800 outline-none transition focus:border-slate-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </div>
          </div>

          {loading ? (
            <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
          ) : !feed?.leads.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center dark:border-neutral-700">
              <p className="text-sm text-slate-500 dark:text-neutral-400">
                {view === "support" ? "No support mentions here." : "No leads here yet."}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                {view === "support"
                  ? "Posts marked as support by your configured listener will appear here."
                  : feed?.lastRun
                  ? "The last run found nothing matching this filter."
                  : "Nothing received from the listener yet — check LISTENING_INGEST_SECRET and DASHBOARD_URL."}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence initial={false}>
                {feed.leads.map((lead) => {
                  const t = TIER[lead.tier] ?? TIER.REJECT;
                  const supportLead = lead.kind === "support";
                  return (
                  <motion.article
                    key={lead.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className={`flex min-h-[19rem] flex-col rounded-2xl border p-4 transition-shadow hover:shadow-sm ${t.card}`}
                  >
                    {/* composer lives at the bottom; declared here for clarity */}
                    {/* Tweet header: who, then the platform mark */}
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold uppercase ${t.avatar}`}
                        aria-hidden="true"
                      >
                        {(lead.displayName || lead.username).charAt(0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={`https://x.com/${lead.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`block truncate text-sm font-semibold hover:underline ${t.name}`}
                        >
                          {lead.displayName || lead.username}
                        </a>
                        <span className={`block truncate text-xs ${t.muted}`}>
                          @{lead.username}
                          {lead.followers && (
                            <span className="tabular-nums"> · {lead.followers} followers</span>
                          )}
                        </span>
                      </div>
                      <a
                        href={lead.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open on X"
                        className={`shrink-0 rounded-md p-1 transition ${t.muted} hover:opacity-70`}
                      >
                        <XLogo className="h-4 w-4" />
                      </a>
                    </div>

                    {/* The post */}
                    <p
                      className={`mt-3 whitespace-pre-wrap text-[15px] leading-relaxed ${t.body}`}
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 6,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {lead.content}
                    </p>

                    {/* Everything below sits on the floor of the card */}
                    <div className="mt-auto pt-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${t.label_}`}
                        >
                          {supportLead ? (lead.tier === "HOT" ? "Urgent support" : "Support") : t.label}
                        </span>
                        <span className={`truncate text-[11px] tabular-nums ${t.muted}`}>
                          {cardDateTime(lead.postedAt || lead.receivedAt)}
                          {lead.matchedQuery ? ` · ${lead.matchedQuery}` : ""}
                        </span>
                      </div>

                      {lead.reason && (
                        <p className={`mt-1.5 line-clamp-2 text-xs ${t.muted}`}>{lead.reason}</p>
                      )}

                      <div className={`mt-3 flex items-center gap-1 border-t pt-3 ${t.rule}`}>
                        <button
                          onClick={() =>
                            patch(lead.id, {
                              status: lead.status === "contacted" ? "new" : "contacted",
                            })
                          }
                          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                            lead.status === "contacted"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                              : t.chip
                          }`}
                        >
                          <CheckCircleIcon className="h-3 w-3" />
                          {lead.status === "contacted"
                            ? supportLead ? "Handled" : "Contacted"
                            : supportLead ? "Mark handled" : "Contact"}
                        </button>
                        <button
                          onClick={() => patch(lead.id, { status: "ignored" })}
                          title="Ignore"
                          className={`rounded-lg p-1.5 transition ${t.chip}`}
                        >
                          <EyeOffIcon className="h-3 w-3" />
                        </button>

                        <div className="ml-auto flex items-center gap-1">
                          {!supportLead && (
                            <>
                          <button
                            title="Good lead — teaches the model"
                            onClick={() =>
                              patch(lead.id, { rating: lead.rating === "good" ? null : "good" })
                            }
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              lead.rating === "good"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                                : t.chip
                            }`}
                          >
                            Good
                          </button>
                          <button
                            title="Not relevant — teaches the model"
                            onClick={() =>
                              patch(lead.id, { rating: lead.rating === "bad" ? null : "bad" })
                            }
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              lead.rating === "bad"
                                ? "bg-rose-200 text-rose-900 dark:bg-rose-500/25 dark:text-rose-100"
                                : t.chip
                            }`}
                          >
                            Not it
                          </button>
                            </>
                          )}
                          <button
                            title="Erase this person from the CRM"
                            onClick={() => erase(lead)}
                            className={`rounded-lg p-1.5 transition ${t.muted} hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20 dark:hover:text-rose-200`}
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      <ReplyBox
                        lead={lead}
                        tier={t}
                        quota={quota}
                        onSent={(updated) => {
                          setFeed((f) =>
                            f
                              ? { ...f, leads: f.leads.map((l) => (l.id === updated.id ? updated : l)) }
                              : f
                          );
                          loadQuota();
                        }}
                      />
                    </div>
                  </motion.article>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showWatchers && <WatcherPanel onClose={() => setShowWatchers(false)} />}
      </AnimatePresence>
    </div>
  );
}

/**
 * Reply composer.
 *
 * Posts a public reply from your X account via the cookie session. Everything
 * here assumes a person is writing: nothing is pre-filled, nothing is generated,
 * and the server rejects text you have already sent to someone else this week.
 * The daily cap is shown before you start so pacing is visible, not a surprise.
 */
function ReplyBox({
  lead,
  tier,
  quota,
  onSent,
}: {
  lead: Lead;
  tier: (typeof TIER)[keyof typeof TIER];
  quota: ReplyQuota | null;
  onSent: (lead: Lead) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lead.repliedAt) {
    return (
      <p className={`mt-2 border-t pt-2 text-[11px] ${tier.rule} ${tier.muted}`}>
        Replied {listTime(lead.repliedAt)} — “{lead.replyText}”
      </p>
    );
  }

  const outOfQuota = quota ? quota.remaining <= 0 : false;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={outOfQuota || quota?.sessionReady === false}
        className={`mt-2 w-full rounded-lg py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tier.chip}`}
        title={
          quota?.sessionReady === false
            ? "No X session — set X_AUTH_TOKEN and X_CT0"
            : outOfQuota
              ? "Daily reply cap reached"
              : "Reply on X"
        }
      >
        {outOfQuota ? "Daily cap reached" : "Reply"}
      </button>
    );
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/listening/leads/${lead.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      onSent(data.lead);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`mt-2 border-t pt-2 ${tier.rule}`}>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={280}
        placeholder={`Reply to @${lead.username} — this posts publicly from your account`}
        className="w-full rounded-lg border border-black/10 bg-white/70 p-2 text-xs leading-relaxed text-slate-800 outline-none focus:border-black/25 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100"
      />
      {error && <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <span className={`text-[10px] tabular-nums ${tier.muted}`}>
          {text.length}/280
          {quota ? ` · ${quota.remaining} left today` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              setOpen(false);
              setText("");
              setError(null);
            }}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${tier.chip}`}
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || text.trim().length < 15}
            className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {sending ? "Posting…" : "Post reply"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Edits watchers.json on the listener through the server-side proxy. */
function WatcherPanel({ onClose }: { onClose: () => void }) {
  const [watchers, setWatchers] = useState<Watcher[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/listening/watchers")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        setWatchers(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  function update(i: number, patch: Partial<Watcher>) {
    setWatchers((ws) => (ws ? ws.map((w, j) => (j === i ? { ...w, ...patch } : w)) : ws));
    setSaved(false);
  }

  async function save() {
    if (!watchers) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/listening/watchers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(watchers),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.97, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 8 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
            Watchers &amp; queries
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          {error && (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}
          {!watchers && !error && <p className="text-xs text-slate-400">Loading…</p>}

          {watchers?.map((w, i) => (
            <div key={i} className="mb-4">
              <div className="mb-1.5 flex items-center gap-2">
                <input
                  value={w.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <input
                  value={w.chatId}
                  onChange={(e) => update(i, { chatId: e.target.value })}
                  placeholder="Telegram chat ID"
                  className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
              <textarea
                value={w.queries.join("\n")}
                onChange={(e) =>
                  update(i, { queries: e.target.value.split("\n").map((q) => q.trim()).filter(Boolean) })
                }
                rows={Math.min(w.queries.length + 2, 14)}
                spellCheck={false}
                className="w-full rounded-lg border border-slate-200 p-2 font-mono text-[11px] leading-relaxed text-slate-700 outline-none focus:border-slate-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                One query per line. {w.queries.length} queries — each one costs a fixed
                amount per run whether or not it finds anything.
              </p>
            </div>
          ))}

          {watchers && (
            <button
              onClick={() =>
                setWatchers([...watchers, { name: "New", chatId: "REPLACE_WITH_CHAT_ID", queries: [] }])
              }
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:text-neutral-400"
            >
              <PlusIcon className="h-3 w-3" /> Add watcher
            </button>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-neutral-800">
          <p className="text-[11px] text-slate-400">
            {saved ? "Saved — applies on the next run." : "Applies on the listener's next run."}
          </p>
          <button
            onClick={save}
            disabled={!watchers || saving}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
