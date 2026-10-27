"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ConversationDTO, KeywordAlertDTO } from "@/lib/types";
import { BellIcon, CheckIcon, CloseIcon, PlusIcon } from "./icons";

type Scope = "conversation" | "all_groups";

function ruleFor(
  rules: KeywordAlertDTO[],
  scope: Scope,
  conversationId: string,
) {
  return rules.find((rule) =>
    scope === "all_groups"
      ? rule.conversationId === null
      : rule.conversationId === conversationId,
  );
}

export function KeywordAlertControl({
  conversation,
  compact = false,
}: {
  conversation: ConversationDTO;
  compact?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<KeywordAlertDTO[]>([]);
  const [scope, setScope] = useState<Scope>("conversation");
  const [phrases, setPhrases] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unavailable">(
    "unavailable",
  );

  const active = useMemo(
    () => rules.some((rule) => rule.enabled && rule.phrases.length > 0),
    [rules],
  );

  async function loadRules() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/keyword-alerts?conversationId=${encodeURIComponent(conversation.id)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as KeywordAlertDTO[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(!Array.isArray(data) && data.error ? data.error : "Alerts could not load");
      }
      setRules(data);
      const rule = ruleFor(data, scope, conversation.id);
      setPhrases(rule?.phrases ?? []);
      setEnabled(rule?.enabled ?? true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Alerts could not load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    void loadRules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    if (open) void loadRules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function selectScope(nextScope: Scope) {
    setScope(nextScope);
    const rule = ruleFor(rules, nextScope, conversation.id);
    setPhrases(rule?.phrases ?? []);
    setEnabled(rule?.enabled ?? true);
    setDraft("");
    setSaved(false);
    setError(null);
  }

  function addPhrases() {
    const candidates = draft
      .split(/[,\n|]/)
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter((value) => value.length >= 2);
    if (!candidates.length) return;
    setPhrases((current) => {
      const seen = new Set(current.map((value) => value.toLocaleLowerCase()));
      return [
        ...current,
        ...candidates.filter((value) => {
          const key = value.toLocaleLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ].slice(0, 30);
    });
    setDraft("");
    setSaved(false);
  }

  async function requestDesktopPermission() {
    if (typeof Notification === "undefined") return;
    const next = await Notification.requestPermission();
    setPermission(next);
  }

  async function save() {
    if (draft.trim()) addPhrases();
    const nextPhrases = draft.trim()
      ? Array.from(
          new Map(
            [...phrases, ...draft.split(/[,\n|]/).map((value) => value.trim())]
              .filter((value) => value.length >= 2)
              .map((value) => [value.toLocaleLowerCase(), value]),
          ).values(),
        ).slice(0, 30)
      : phrases;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/keyword-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          conversationId: conversation.id,
          phrases: nextPhrases,
          enabled,
        }),
      });
      const data = (await response.json()) as KeywordAlertDTO | { error?: string };
      if (!response.ok || !("id" in data)) {
        throw new Error("error" in data && data.error ? data.error : "Alert could not save");
      }
      setPhrases(data.phrases);
      setRules((current) => [
        data,
        ...current.filter((rule) => rule.id !== data.id),
      ]);
      setDraft("");
      setSaved(true);
      window.dispatchEvent(new CustomEvent("omnicrm-keyword-alerts-changed"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Alert could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={active ? "Keyword alerts on" : "Watch for keywords"}
        aria-label={active ? "Manage active keyword alerts" : "Create a keyword alert"}
        aria-expanded={open}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          active
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
        }`}
      >
        <BellIcon className="h-4 w-4" />
        <span className="keyword-alert-label hidden">Keyword alerts</span>
        {active && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-800" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className={`keyword-alert-panel absolute right-0 top-full z-50 mt-2 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-xl dark:border-neutral-700 dark:bg-[#1F1F1F] ${compact ? "max-w-[20rem]" : ""}`}
            aria-label="Telegram keyword alerts"
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  Keyword alerts
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                  Get notified when a phrase appears.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                aria-label="Close keyword alerts"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-neutral-800">
                {([
                  ["conversation", "This group"],
                  ["all_groups", "All TG groups"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => selectScope(value)}
                    className={`rounded-md px-2.5 py-2 text-xs font-semibold transition-all duration-200 ${
                      scope === value
                        ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                {scope === "conversation"
                  ? `Only messages in ${conversation.contact.name}.`
                  : "Messages in any synced Telegram group."}
              </p>

              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                Words or phrases
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setSaved(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addPhrases();
                    }
                  }}
                  placeholder="e.g. facebook ad accounts"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/15 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <button
                  type="button"
                  onClick={addPhrases}
                  disabled={draft.trim().length < 2}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-all duration-200 hover:bg-slate-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  aria-label="Add phrase"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2 flex min-h-8 flex-wrap gap-1.5">
                {phrases.map((phrase) => (
                  <span
                    key={phrase.toLocaleLowerCase()}
                    className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent/10 py-1 pl-2 pr-1 text-xs font-medium text-accent"
                  >
                    <span className="truncate">{phrase}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPhrases((current) => current.filter((item) => item !== phrase));
                        setSaved(false);
                      }}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-accent/15"
                      aria-label={`Remove ${phrase}`}
                    >
                      <CloseIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {!loading && phrases.length === 0 && (
                  <span className="py-1 text-xs text-slate-400">Add at least one phrase.</span>
                )}
                {loading && <span className="py-1 text-xs text-slate-400">Loading alerts…</span>}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-neutral-800">
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-neutral-200">
                    Alert is {enabled && phrases.length ? "on" : "off"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    Matches are not case-sensitive.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => {
                    setEnabled((current) => !current);
                    setSaved(false);
                  }}
                  className={`relative h-6 w-11 rounded-full transition-all duration-200 ${enabled ? "bg-accent" : "bg-slate-300 dark:bg-neutral-600"}`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200 ${enabled ? "left-6" : "left-1"}`} />
                </button>
              </div>

              {permission !== "granted" && (
                <button
                  type="button"
                  onClick={() => void requestDesktopPermission()}
                  disabled={permission === "denied" || permission === "unavailable"}
                  className="mt-3 w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-xs leading-5 text-slate-600 transition-all duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  {permission === "denied"
                    ? "Desktop alerts are blocked in browser settings. In-app alerts will still work."
                    : permission === "unavailable"
                      ? "In-app alerts are ready. Desktop alerts are unavailable in this browser."
                      : "Allow desktop alerts while Omni is open"}
                </button>
              )}

              {error && (
                <p className="mt-3 text-xs leading-5 text-red-600 dark:text-red-300" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-neutral-800">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {saved && <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />}
                {saved ? "Saved" : "Alerts appear in Omni instantly."}
              </span>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || loading}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {saving ? "Saving…" : "Save alert"}
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
