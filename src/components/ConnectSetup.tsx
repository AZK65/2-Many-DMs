"use client";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { PlatformGlyph } from "./PlatformIcon";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { fetchJson } from "@/lib/fetch-json";
import type { SetupConnections } from "@/lib/connection-setup";
import { WhatsAppLinkCode } from "./WhatsAppLinkCode";

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
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-800 dark:bg-neutral-800 dark:text-neutral-100"><PlatformGlyph platform={platform} className="h-5 w-5" /></span>
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
  const ready = connections?.workerRunning && live?.state === "ready";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [passcode, setPasscode] = useState("");
  const notified = useRef(false);
  const callback = useRef(onReady); callback.current = onReady;
  useEffect(() => { if (ready && !notified.current) { notified.current = true; callback.current?.(); } }, [ready]);
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
    e.preventDefault(); if (busy) return; setBusy(true); setMessage("");
    try {
      await fetchJson("/api/accounts/x/passcode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, passcode }), signal: AbortSignal.timeout(10_000) }, "X Chat unlock");
      setPasscode(""); setMessage("Passcode saved securely. Waiting for X to confirm the unlock. A rejected code is not retried automatically.");
    } catch (cause) { setMessage((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div role="status" className={`rounded-xl p-4 ${ready ? "bg-accent/10" : "bg-slate-50 dark:bg-neutral-800"}`}>
      <p className="text-sm font-semibold">{ready ? "Connected and ready" : !connections ? "Checking your connection" : !connections.workerRunning ? "Account saved. Start sync to continue" : live?.state === "disconnected" || live?.state === "disabled" ? "Connection needs attention" : "Account saved. Connecting…"}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">{ready ? "Your inbox is available. Older chats may continue importing in the background; connection does not mean all history is loaded." : live?.detail || (platform === "whatsapp" ? "Your account slot is saved. Link your phone when the QR appears. You can reopen setup to finish later." : "Your login is saved on this server. You can close setup without losing it.")}</p>
    </div>
    {connections && !connections.workerRunning && <button type="button" disabled={busy} onClick={start} className={setupButton}>{busy ? "Starting sync…" : "Start sync"}</button>}
    {platform === "x" && /lock|passcode/i.test(live?.detail || "") && <form onSubmit={unlock} className="space-y-3">
      <SetupField label="X Chat passcode" type="password" inputMode="numeric" autoComplete="off" value={passcode} onChange={e => setPasscode(e.target.value.replace(/\D/g, ""))} maxLength={32} disabled={busy} hint="Use the passcode you already use in X Chat, not your X account password. It is stored encrypted on your server. If you forgot it, recover access in X first." />
      <button disabled={busy || passcode.length < 4} className={setupButton}>{busy ? "Saving…" : "Unlock encrypted chats"}</button>
    </form>}
    {error && <SetupError>{error}</SetupError>}
    {message && <p role="status" className="text-sm text-slate-500 dark:text-neutral-400">{message}</p>}
  </div>;
}

export function SavedConnection({ accountId, platform, onClose, driver }: { accountId: string; platform: Platform; driver?: string | null; onClose: () => void }) {
  const { connections } = useSetupConnections();
  const live = connections?.platforms.accounts?.find(a => a.accountId === accountId);
  return <ConnectShell platform={platform} subtitle="Check the account you already saved." steps={["Account saved", "Sync"]} current={1} onClose={onClose}>
    {platform === "whatsapp" && live?.state === "qr"
      ? <WhatsAppLinkCode qr={live.qr} label="WhatsApp" accountId={accountId} canRefresh={driver === "web" || driver === "baileys"} />
      : <ConnectionProgress platform={platform} accountId={accountId} />}
    <button type="button" className={`${setupButton} mt-6 w-full`} onClick={onClose}>Done</button>
  </ConnectShell>;
}
