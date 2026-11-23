"use client";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { PlatformLogo } from "./PlatformLogo";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { fetchJson } from "@/lib/fetch-json";
import type { SetupConnections } from "@/lib/connection-setup";
import { WhatsAppLinkCode } from "./WhatsAppLinkCode";
import { isXChatPin, X_CHAT_PIN_LENGTH, latestXUnlockState, xUnlockCheckExpired, X_UNLOCK_UI_TIMEOUT_MS, xInboxVerified, xNeedsUnlock, type XUnlockState } from "@/lib/x-unlock-state";

export const setupButton = "rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-neutral-900";
export const setupSecondary = "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800";

export function ConnectShell({ platform, subtitle, steps, current, busy, onClose, children }: {
  platform: Platform; subtitle: string; steps: string[]; current: number; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return <OverlayPortal onClose={busy ? undefined : onClose}>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" onClick={busy ? undefined : onClose}>
      <motion.section role="dialog" aria-modal="true" aria-label={`Connect ${PLATFORMS[platform].label}`}
        initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }}
        onClick={e => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
        <header className="flex items-start gap-3">
          <PlatformLogo platform={platform} />
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">Connect {PLATFORMS[platform].label}</h2><p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{subtitle}</p></div>
          <button type="button" onClick={onClose} disabled={busy} className={setupSecondary} aria-label="Close setup">✕</button>
        </header>
        <ol aria-label="Connection steps" className="my-6 flex gap-2 text-xs">
          {steps.map((step, i) => <li key={step} aria-current={i === current ? "step" : undefined} className={`flex flex-1 items-center gap-2 ${i <= current ? "text-slate-900 dark:text-neutral-100" : "text-slate-400 dark:text-neutral-500"}`}>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-medium ${i <= current ? "bg-accent/15 text-accent" : "bg-slate-100 dark:bg-neutral-800"}`}>{i < current ? "✓" : i + 1}</span><span>{step}</span>
          </li>)}
        </ol>
        {children}
      </motion.section>
    </motion.div>
  </OverlayPortal>;
}

export function SetupField({ label, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId(); const id = input.id || generatedId;
  return <div><label htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label>
    <input {...input} id={id} aria-describedby={hint ? `${id}-hint` : input["aria-describedby"]} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-base outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500" />
    {hint && <span id={`${id}-hint`} className="mt-2 block text-xs text-slate-500 dark:text-neutral-400">{hint}</span>}
  </div>;
}
export function SetupError({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{children}</p>;
}

export function useSetupConnections() {
  const [connections, setConnections] = useState<SetupConnections | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await fetchJson<SetupConnections>("/api/connections", { cache: "no-store", signal: AbortSignal.timeout(6000) }, "Connection status");
        if (!stopped) { setConnections(result); setError(""); }
      } catch { if (!stopped) { setConnections(null); setError("Cannot check connection status. Reconnecting to the server…"); } }
      if (!stopped) timer = setTimeout(load, 4000);
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return { connections, error };
}

export function ConnectionProgress({ accountId, platform, onReady }: { accountId: string; platform: Platform; onReady?: () => void }) {
  const { connections, error } = useSetupConnections();
  const live = connections?.platforms.accounts?.find(a => a.accountId === accountId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [passcode, setPasscode] = useState("");
  const [unlockResult, setUnlockResult] = useState<XUnlockState | null>(null);
  const [unlockError, setUnlockError] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [checkStartedAt, setCheckStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const unlockRequest = useRef<AbortController | null>(null);
  const feedback = latestXUnlockState(live?.unlock, unlockResult);
  const checking = Boolean(unlockRequest.current) || (!unlockError && feedback?.state === "verifying");
  const checkOverdue = checking && xUnlockCheckExpired(checkStartedAt || feedback?.startedAt || 0, now);
  const checkingCode = checking && !checkOverdue;
  const ready = !checking && connections?.workerRunning && (platform === "x" ? xInboxVerified(live) : live?.state === "ready");
  const needsCode = platform === "x" && (xNeedsUnlock(live) || checking || Boolean(unlockError));
  const notified = useRef(false);
  const callback = useRef(onReady); callback.current = onReady;
  useEffect(() => { if (ready && !notified.current) { notified.current = true; callback.current?.(); } }, [ready]);
  useEffect(() => {
    if (!checking) return;
    // Older workers may omit startedAt. Start a local deadline once instead
    // of resetting it on every render, which used to leave "Checking" forever.
    if (!checkStartedAt || (!unlockRequest.current && (feedback?.startedAt || 0) > checkStartedAt)) setCheckStartedAt(feedback?.startedAt || Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [checking, checkStartedAt, feedback?.startedAt]);
  useEffect(() => {
    if (!checkOverdue) return;
    unlockRequest.current?.abort(); unlockRequest.current = null;
    setBusy(false); setPasscode("");
    setUnlockError("X did not return a result in time. This does not mean your PIN is wrong. Check the connection before trying again; no automatic retry was made.");
  }, [checkOverdue]);
  useEffect(() => () => { unlockRequest.current?.abort(); unlockRequest.current = null; }, []);
  useEffect(() => {
    const update = live?.unlock;
    if (!unlockRequest.current || !update || update.state === "verifying" || update.state === "required" ||
      (update.updatedAt ?? update.startedAt ?? 0) < checkStartedAt) return;
    // A lost POST response must not conceal the result already received by
    // status polling. Aborting the local fetch never resubmits the PIN.
    unlockRequest.current.abort(); unlockRequest.current = null;
    setUnlockResult(update); setUnlockError(""); setBusy(false); setPasscode("");
  }, [live?.unlock, checkStartedAt]);
  useEffect(() => {
    if (live?.unlock?.state !== "unlocked") return;
    setUnlockError("");
  }, [live?.unlock?.state, live?.unlock?.updatedAt]);
  async function start() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      await fetchJson("/api/worker/start", { method: "POST", signal: AbortSignal.timeout(10_000) }, "Starting sync");
      setMessage("Sync is starting. This screen will update when it is ready.");
    } catch { setMessage("Sync could not start here. The server owner can start it with npm run sync. No need to sign in again."); }
    finally { setBusy(false); }
  }
  async function unlock(e: React.FormEvent) {
    e.preventDefault(); if (busy || checkingCode || unlockRequest.current || !isXChatPin(passcode)) return;
    const controller = new AbortController();
    unlockRequest.current = controller; setBusy(true); setMessage(""); setUnlockError(""); setUnlockResult(null);
    setCheckStartedAt(Date.now()); setNow(Date.now());
    const code = passcode; setShowCode(false);
    try {
      const result = await fetchJson<{ unlock: XUnlockState }>("/api/accounts/x/passcode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, passcode: code }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(X_UNLOCK_UI_TIMEOUT_MS)]) }, "X Chat unlock");
      if (unlockRequest.current === controller) setUnlockResult(result.unlock);
    } catch (cause) {
      if (unlockRequest.current === controller) setUnlockError((cause as Error).name === "TimeoutError" ? "X did not return a result in time. This does not mean your PIN is wrong. Check X before trying again; no automatic retry was made." : (cause as Error).message);
    } finally {
      if (unlockRequest.current === controller) { unlockRequest.current = null; setBusy(false); setPasscode(""); }
    }
  }
  return <div className="space-y-4">
    <div role="status" className={`rounded-xl p-4 ${ready ? "bg-accent/10" : "bg-slate-50 dark:bg-neutral-800"}`}>
      <p className="text-sm font-semibold">{checkOverdue ? "X has not returned a result" : checkingCode ? "Checking your PIN with X…" : ready ? "Connected and ready" : feedback?.state === "rejected" ? "Incorrect PIN" : feedback?.state === "error" || unlockError ? "Could not verify your PIN" : needsCode ? "Unlock your X chats" : !connections ? "Checking your connection" : !connections.workerRunning ? "Account saved. Start sync to continue" : live?.state === "disconnected" || live?.state === "disabled" ? "Connection needs attention" : "Account saved. Connecting…"}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">{ready ? "Your inbox is available. Older chats may continue importing in the background; connection does not mean all history is loaded." : checkOverdue ? "Verification is taking too long. You can close setup and check X. This does not mean the PIN is wrong; we will not retry it automatically." : needsCode ? checkingCode ? `${feedback?.state === "verifying" ? feedback.detail : "Waiting for X to accept or reject your PIN and open the inbox."} This check stops after 45 seconds.` : "Use the 4-digit PIN you created when setting up X Chat." : live?.detail || (platform === "whatsapp" ? "Your account slot is saved. Link your phone when the QR appears. You can reopen setup to finish later." : "Your login is saved on this server. You can close setup without losing it.")}</p>
    </div>
    {connections && !connections.workerRunning && <button type="button" disabled={busy} onClick={start} className={setupButton}>{busy ? "Starting sync…" : "Start sync"}</button>}
    {needsCode && <form onSubmit={unlock} className="space-y-3" aria-busy={checkingCode}>
      <SetupField label="X Chat PIN · 4 digits" autoFocus type={showCode ? "text" : "password"} inputMode="numeric" autoComplete="off" value={passcode} onChange={e => setPasscode(e.target.value.replace(/\D/g, ""))} maxLength={X_CHAT_PIN_LENGTH} minLength={X_CHAT_PIN_LENGTH} pattern="[0-9]{4}" required disabled={busy || checkingCode} hint={`${passcode.length} of 4 digits entered. Use your Chat PIN, not your X password or an SMS code. The PIN is not saved to disk.`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setShowCode(value => !value)} aria-pressed={showCode} disabled={busy || checkingCode} className={setupSecondary}>{showCode ? "Hide code" : "Show code"}</button>
        <button disabled={busy || checkingCode || !isXChatPin(passcode)} className={setupButton}>{checkOverdue ? "Result unavailable" : checkingCode ? "Checking PIN…" : "Unlock chats"}</button>
      </div>
      <p className="text-xs text-slate-500 dark:text-neutral-400">We only confirm success after X opens your inbox. Incorrect codes are not retried automatically. <a href="https://x.com/i/chat" target="_blank" rel="noreferrer" className="text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Forgot your code? Recover it in X.</a></p>
    </form>}
    {!checkingCode && feedback && feedback.state !== "required" && feedback.state !== "verifying" && <p role={feedback.state === "unlocked" ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${feedback.state === "unlocked" ? "bg-accent/10 text-slate-900 dark:text-neutral-100" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"}`}>{feedback.detail}</p>}
    {unlockError && <SetupError>{unlockError}</SetupError>}
    {error && <SetupError>{error}</SetupError>}
    {message && <p role="status" className="text-sm text-slate-500 dark:text-neutral-400">{message}</p>}
  </div>;
}

export function SavedConnection({ accountId, platform, onClose, driver, onReconnect }: { accountId: string; platform: Platform; driver?: string | null; onClose: () => void; onReconnect?: () => void }) {
  const { connections } = useSetupConnections();
  const live = connections?.platforms.accounts?.find(a => a.accountId === accountId);
  return <ConnectShell platform={platform} subtitle="Check the account you already saved." steps={["Account saved", "Sync"]} current={1} onClose={onClose}>
    {platform === "whatsapp" && live?.state === "qr"
      ? <WhatsAppLinkCode qr={live.qr} label="WhatsApp" accountId={accountId} canRefresh={driver === "web" || driver === "baileys"} />
      : <ConnectionProgress platform={platform} accountId={accountId} />}
    {onReconnect && platform !== "whatsapp" && live?.state === "disconnected" && !(platform === "x" && xNeedsUnlock(live)) && <button type="button" className={`${setupSecondary} mt-4 w-full`} onClick={onReconnect}>Sign in again</button>}
    <button type="button" className={`${platform === "x" && xNeedsUnlock(live) ? setupSecondary : setupButton} mt-6 w-full`} onClick={onClose}>Done</button>
  </ConnectShell>;
}
