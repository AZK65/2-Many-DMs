"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { UpdateDialog, type UpdateCheck } from "./UpdateDialog";
import changelog from "../../public/changelog.json";
import { AutoUpdateControl, useUpdatePreferences, UPDATE_REVIEW_EVENT } from "./UpdatePreferences";
import { autoUpdateSeconds } from "@/lib/auto-update-policy";
import { loadConversationDrafts } from "@/lib/drafts";

export function UpdateBanner() {
  const [data, setData] = useState<UpdateCheck | null>(null);
  const [hidden, setHidden] = useState(true);
  const [preview, setPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const applyingRef = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<number | null>(null);
  const dismissedRevision = useRef<string | null>(null);
  const preferences = useUpdatePreferences(!preview);
  const [previewAuto, setPreviewAuto] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const noticed = useRef({ revision: "", at: Date.now() });
  const lastActivity = useRef(Date.now());
  const automaticAttempts = useRef(new Set<string>());
  const pullRef = useRef<(automatic: boolean) => void>(() => {});
  const preferenceRef = useRef(preferences.value);
  preferenceRef.current = preferences.value;
  const reviewingSkipped = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let checking = false;
    const isPreview = new URLSearchParams(window.location.search).get("previewUpdate") === "1";
    if (isPreview) {
      setPreview(true);
      setData({ current: changelog.current, latest: changelog.current, hasUpdate: false,
        canApply: false, selfUpdate: false, entries: changelog.entries.slice(0, 1) });
      setHidden(false);
    }
    const check = async (force = false) => {
      if (isPreview || applyingRef.current || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/updates/check", { cache: "no-store" });
        if (!response.ok) return;
        const result: UpdateCheck = await response.json();
        if (!active || applyingRef.current) return;
        if (!result?.hasUpdate) { setHidden(true); return; }
        setData(result);
        if (noticed.current.revision !== result.latestSha) { noticed.current = { revision: result.latestSha || "", at: Date.now() }; reviewingSkipped.current = false; }
        if (force) reviewingSkipped.current = true;
        setInstalled(false);
        setApplyMsg(null);
        let dismissed = dismissedRevision.current;
        try { dismissed ||= localStorage.getItem("dismissedUpdate"); } catch { /* storage may be disabled */ }
        setHidden(!reviewingSkipped.current && (dismissed === result.latest || dismissed === result.latestSha || preferenceRef.current.skippedRevision === result.latestSha));
      } catch { /* Offline checks must not interrupt the inbox. */ }
      finally { checking = false; }
    };
    void check();
    const interval = window.setInterval(() => void check(), 10 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") void check(); };
    const review = () => { noticed.current.at = Date.now(); void check(true); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(UPDATE_REVIEW_EVENT, review);
    return () => {
      active = false;
      mounted.current = false;
      window.clearInterval(interval);
      if (timer.current !== null) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(UPDATE_REVIEW_EVENT, review);
    };
  }, []);

  useEffect(() => {
    const activity = () => { lastActivity.current = Date.now(); };
    for (const event of ["pointerdown", "keydown", "input", "wheel", "visibilitychange"]) document.addEventListener(event, activity, { capture: true, passive: true });
    return () => { for (const event of ["pointerdown", "keydown", "input", "wheel", "visibilitychange"]) document.removeEventListener(event, activity, true); };
  }, []);
  useEffect(() => { lastActivity.current = Date.now(); }, [preferences.value.autoUpdate]);
  useEffect(() => {
    if (!preview && !reviewingSkipped.current && data?.latestSha && preferences.value.skippedRevision === data.latestSha) setHidden(true);
  }, [preferences.value.skippedRevision, data?.latestSha, preview]);
  useEffect(() => {
    const tick = () => {
      const revision = data?.latestSha || null;
      const unsavedInput = Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), [contenteditable="true"]')).some(element => element.getClientRects().length && (element.value || element.textContent || "").trim());
      const remaining = autoUpdateSeconds({ enabled: preferences.value.autoUpdate, configurable: preferences.value.configurable, ready: preferences.ready,
        preview, visible: !hidden && document.visibilityState === "visible", busy: applying || installed || preferences.saving,
        blocked: !data?.canApply || !data.selfUpdate || !data.hasUpdate || document.querySelectorAll('[role="dialog"]').length > 1 || !!(revision && automaticAttempts.current.has(revision)),
        hasDraft: unsavedInput || Object.keys(loadConversationDrafts()).length > 0,
        revision, skipped: preferences.value.skippedRevision, attempted: preferences.value.attemptedRevision,
        noticedAt: noticed.current.at, lastActivityAt: lastActivity.current, now: Date.now() });
      setSeconds(remaining);
      // A paused safety check must not consume the visible countdown. Start a
      // fresh quiet minute when drafts, visibility, or preference errors clear.
      if (remaining === null) lastActivity.current = Date.now();
      if (remaining === 0) pullRef.current(true);
    };
    tick(); const interval = window.setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data, hidden, preview, applying, installed, preferences.value, preferences.ready, preferences.saving]);

  async function skip() {
    if (applyingRef.current || preferences.saving) return;
    if (!preview && data?.latestSha && (preferences.value.configurable || !preferences.ready)) {
      if (!await preferences.save({ skippedRevision: data.latestSha })) return;
    }
    dismiss();
  }

  function dismiss() {
    if (applyingRef.current) return;
    reviewingSkipped.current = false;
    if (!preview && data) {
      dismissedRevision.current = data.latestSha || data.latest;
      try { localStorage.setItem("dismissedUpdate", data.latestSha || data.latest); } catch { /* still dismiss this session */ }
    }
    if (preview) {
      const url = new URL(window.location.href);
      url.searchParams.delete("previewUpdate");
      window.history.replaceState(window.history.state, "", url);
    }
    setHidden(true);
  }

  function schedule(callback: () => void, delay: number) {
    if (!mounted.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(callback, delay);
  }

  function finish(message: string) {
    if (!mounted.current) return;
    applyingRef.current = false;
    setApplying(false);
    setApplyMsg(message);
  }

  // A 200 response alone is not proof of restart: the old server can still
  // answer while the build is finishing. Wait for the new process's idle state
  // AND the exact revision the user approved.
  function waitForRestart(expectedRevision: string, deadline = Date.now() + 4 * 60_000) {
    if (!mounted.current) return;
    setApplyMsg("Restarting the app…");
    schedule(() => { void (async () => {
      try {
        const stateResponse = await fetch("/api/updates/apply", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const state = stateResponse.ok ? await stateResponse.json() : null;
        if (state?.phase === "idle") {
          const checkResponse = await fetch("/api/updates/check", { cache: "no-store", signal: AbortSignal.timeout(15000) });
          const check = checkResponse.ok ? await checkResponse.json() : null;
          if (mounted.current && check?.currentSha === expectedRevision) { window.location.reload(); return; }
        }
      } catch { /* A short outage is expected during restart. */ }
      if (Date.now() >= deadline) { finish("The server has not returned yet. Reopen the app after it finishes restarting."); return; }
      waitForRestart(expectedRevision, deadline);
    })(); }, 3000);
  }

  function poll(expectedRevision: string, deadline = Date.now() + 20 * 60_000) {
    schedule(() => { void (async () => {
      try {
        const response = await fetch("/api/updates/apply", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Update status is unavailable");
        const state = await response.json();
        if (!mounted.current) return;
        if (state.error) { finish("Update failed: " + state.error); return; }
        if (state.restartRequired) { setInstalled(true); finish("Installed. Restart the app and sync worker to finish."); return; }
        if (state.done || state.restarting) { waitForRestart(expectedRevision); return; }
        setApplyMsg((state.phase || "Working") + "…");
      } catch { waitForRestart(expectedRevision); return; }
      if (Date.now() >= deadline) { finish("The update is taking longer than expected. Check the server before trying again."); return; }
      poll(expectedRevision, deadline);
    })(); }, 2000);
  }

  async function pull(automatic = false) {
    if (preview || installed || applyingRef.current || !data?.hasUpdate || !data.canApply || !data.selfUpdate || !data.latestSha) return;
    const expectedRevision = data.latestSha;
    if (automatic) {
      if (!preferences.ready || !preferences.value.autoUpdate || automaticAttempts.current.has(expectedRevision)) return;
      automaticAttempts.current.add(expectedRevision);
    }
    applyingRef.current = true;
    setApplying(true);
    setApplyMsg("Starting the update…");
    try {
      const response = await fetch("/api/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-omnicrm-update": "1" },
        body: JSON.stringify({ expectedRevision, automatic }),
      });
      const start = await response.json();
      if (!mounted.current) return;
      if (!response.ok || !start?.started) {
        finish(start?.reason === "self-update-disabled"
          ? "One-click installation is disabled. Use the manual installation steps."
          : start?.error || "The update could not start.");
        return;
      }
      poll(expectedRevision);
    } catch { finish("Couldn’t reach the server. No update was confirmed."); }
  }
  pullRef.current = automatic => void pull(automatic);

  return <AnimatePresence>{data && !hidden && <UpdateDialog key={preview ? "preview" : data.latestSha || data.latest}
    data={data} preview={preview} applying={applying} installed={installed} message={applyMsg}
    onClose={() => { if (!preview && preferences.value.autoUpdate && !installed) void skip(); else dismiss(); }}
    onSkip={() => void skip()} savingPreference={preferences.saving} onUpdate={() => void pull()}
    autoMessage={!preview && !applying && !installed && preferences.value.autoUpdate ? seconds !== null ? `Automatic update in ${seconds}s. Skip this version or turn automatic updates off to cancel.` : preferences.value.skippedRevision === data.latestSha ? "You skipped this version. You can still choose Update now." : preferences.value.attemptedRevision === data.latestSha || automaticAttempts.current.has(data.latestSha || "") ? "Automatic retry is paused for this version. Review the result before updating manually." : "Automatic update is paused while you’re active, have drafts, or a safety check is pending." : null}
    autoControl={!applying && !installed ? <AutoUpdateControl enabled={preview ? previewAuto : preferences.value.autoUpdate} preview={preview}
      disabled={!preview && (!preferences.ready || !preferences.value.configurable)} saving={preferences.saving}
      onChange={enabled => { if (preview) setPreviewAuto(enabled); else void preferences.save({ autoUpdate: enabled }); }}
      error={preview ? undefined : preferences.error} onRetry={() => void preferences.load()} reason={preview ? undefined : preferences.value.reason} /> : null} />}</AnimatePresence>;
}
