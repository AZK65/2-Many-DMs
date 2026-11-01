"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export const UPDATE_PREFERENCES_EVENT = "omni-update-preferences";
export const UPDATE_REVIEW_EVENT = "omni-review-updates";
type Preferences = { autoUpdate: boolean; skippedRevision: string | null; attemptedRevision: string | null; configurable: boolean; reason: string | null };
const initial: Preferences = { autoUpdate: false, skippedRevision: null, attemptedRevision: null, configurable: false, reason: null };

export function useUpdatePreferences(enabled = true) {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!enabled || savingRef.current) return;
    const version = ++generation.current;
    try {
      const response = await fetch("/api/updates/preferences", { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error();
      const data: Preferences = await response.json();
      if (typeof data.autoUpdate !== "boolean" || typeof data.configurable !== "boolean") throw new Error();
      if (alive.current && version === generation.current) { setValue(data); setReady(true); setError(""); }
    } catch { if (alive.current && version === generation.current) { setReady(false); setError("Could not load update settings. Auto updates are paused. Retry to check your preference."); } }
  }, [enabled]);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    void load();
    const timer = window.setInterval(load, 15_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener(UPDATE_PREFERENCES_EVENT, load);
    document.addEventListener("visibilitychange", visible);
    return () => { alive.current = false; ++generation.current; clearInterval(timer); window.removeEventListener(UPDATE_PREFERENCES_EVENT, load); document.removeEventListener("visibilitychange", visible); };
  }, [enabled, load]);
  async function save(patch: { autoUpdate?: boolean; skippedRevision?: string | null }) {
    if (!enabled || savingRef.current) return false;
    savingRef.current = true; ++generation.current; setSaving(true); setError("");
    try {
      const response = await fetch("/api/updates/preferences", { method: "PATCH", headers: { "Content-Type": "application/json", "x-omnicrm-update": "1" }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your preference.");
      if (alive.current) { setValue(data); setReady(true); }
      window.dispatchEvent(new Event(UPDATE_PREFERENCES_EVENT));
      return true;
    } catch (error) { if (alive.current) { setReady(false); setError(error instanceof Error ? error.message : "Could not save. Please retry."); } return false; }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  }
  return { value, ready, saving, error, load, save };
}

export function AutoUpdateControl({ enabled, disabled = false, saving = false, onChange, error, onRetry, reason, preview = false }: {
  enabled: boolean; disabled?: boolean; saving?: boolean; onChange: (value: boolean) => void;
  error?: string; onRetry?: () => void; reason?: string | null; preview?: boolean;
}) {
  const description = useId();
  return <section className="rounded-xl bg-slate-50 p-4 text-left dark:bg-neutral-900">
    <div className="flex items-center justify-between gap-4">
      <div><h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Automatic updates</h3><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{saving ? "Saving…" : enabled ? "On · install for me" : "Off · I’ll choose when to update"}</p></div>
      <button type="button" role="switch" aria-label="Automatic updates" aria-describedby={description} aria-checked={enabled} disabled={disabled || saving} onClick={() => onChange(!enabled)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-neutral-900 ${enabled ? "bg-accent" : "bg-slate-300 dark:bg-neutral-700"}`}>
        <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${enabled ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
    <p id={description} className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">{preview ? "Preview only: this switch does not change your settings or install anything." : "While your inbox is open, check every 10 minutes and install after a visible 60-second countdown with no activity or saved drafts. Updates may restart this installation. Skip a version or turn this off any time in Settings → General. Off still shows update notices."}</p>
    {reason && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{reason}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{error} {onRetry && <button type="button" onClick={onRetry} className="rounded font-semibold underline focus-visible:outline-accent">Retry</button>}</p>}
  </section>;
}

export function UpdatePreferences({ onBusyChange, review = false, onReview }: { onBusyChange?: (busy: boolean) => void; review?: boolean; onReview?: () => void }) {
  const preferences = useUpdatePreferences();
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { onBusyChange?.(preferences.saving); return () => onBusyChange?.(false); }, [preferences.saving, onBusyChange]);
  async function check() {
    setChecking(true); setNotice("");
    try {
      const response = await fetch("/api/updates/check", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error();
      if (result.hasUpdate) { window.dispatchEvent(new Event(UPDATE_REVIEW_EVENT)); onReview?.(); }
      else setNotice("You’re up to date.");
    } catch { setNotice("Could not check for updates. Please try again."); }
    finally { setChecking(false); }
  }
  return <div className="space-y-3">
    <AutoUpdateControl enabled={preferences.value.autoUpdate} disabled={!preferences.ready || !preferences.value.configurable} saving={preferences.saving}
      onChange={value => void preferences.save({ autoUpdate: value })} error={preferences.error} onRetry={() => void preferences.load()} reason={preferences.value.reason} />
    {review && <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-neutral-400">
      <button type="button" disabled={checking || preferences.saving} onClick={() => void check()} className="min-h-11 rounded-lg px-3 font-semibold text-accent hover:bg-accent/10 focus-visible:outline-accent disabled:opacity-50">{checking ? "Checking…" : "Check for updates"}</button>
      <a href="/changelog" target="_blank" rel="noreferrer" className="rounded hover:text-accent focus-visible:outline-accent">Release history ↗</a>
      {notice && <p role="status">{notice}</p>}
    </div>}
  </div>;
}
