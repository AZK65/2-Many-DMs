"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { UpdateDialog, type UpdateCheck } from "./UpdateDialog";
import changelog from "../../public/changelog.json";

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
    const check = async () => {
      if (isPreview || applyingRef.current || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/updates/check", { cache: "no-store" });
        if (!response.ok) return;
        const result: UpdateCheck = await response.json();
        if (!active || applyingRef.current) return;
        if (!result?.hasUpdate) { setHidden(true); return; }
        setData(result);
        setInstalled(false);
        setApplyMsg(null);
        let dismissed = dismissedRevision.current;
        try { dismissed ||= localStorage.getItem("dismissedUpdate"); } catch { /* storage may be disabled */ }
        setHidden(dismissed === result.latest || dismissed === result.latestSha);
      } catch { /* Offline checks must not interrupt the inbox. */ }
      finally { checking = false; }
    };
    void check();
    const interval = window.setInterval(check, 10 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      mounted.current = false;
      window.clearInterval(interval);
      if (timer.current !== null) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function dismiss() {
    if (applyingRef.current) return;
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

  async function pull() {
    if (preview || installed || applyingRef.current || !data?.hasUpdate || !data.canApply || !data.selfUpdate || !data.latestSha) return;
    const expectedRevision = data.latestSha;
    applyingRef.current = true;
    setApplying(true);
    setApplyMsg("Starting the update…");
    try {
      const response = await fetch("/api/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-omnicrm-update": "1" },
        body: JSON.stringify({ expectedRevision }),
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

  return <AnimatePresence>{data && !hidden && <UpdateDialog key={preview ? "preview" : data.latestSha || data.latest}
    data={data} preview={preview} applying={applying} installed={installed} message={applyMsg} onClose={dismiss} onUpdate={() => void pull()} />}</AnimatePresence>;
}
