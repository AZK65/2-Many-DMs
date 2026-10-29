"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectShell, ConnectionProgress, SetupError, setupButton, setupSecondary } from "./ConnectSetup";

type LoginStatus = { state: string; detail?: string; accountId?: string; canLaunch?: boolean; reason?: string };

export function DiscordConnect({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  return <ConnectShell platform="discord" subtitle="Find emails and jump back to the original chat." steps={["Sign in", "Search & sync"]} current={saved ? 1 : 0} onClose={onClose}>
    <DiscordSearchConnect onSaved={setSaved} />
    <button type="button" className={`${setupSecondary} mt-4 w-full`} onClick={onClose}>Close setup</button>
  </ConnectShell>;
}

export function DiscordSearchConnect({ onSaved }: { onSaved?: (saved: boolean) => void } = {}) {
  const [status, setStatus] = useState<LoginStatus>({ state: "checking" });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(false);
  const isLocal = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  useEffect(() => {
    if (!isLocal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!request.current) {
        try {
          const response = await fetch("/api/accounts/discord/search", { cache: "no-store", signal: AbortSignal.timeout(6000) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Could not check Discord setup.");
          if (!cancelled) { setStatus(result); setError(""); }
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not check setup. Retrying shortly.");
        }
      }
      if (!cancelled) timer = setTimeout(refresh, 4000);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isLocal]);

  async function connect() {
    if (request.current) return;
    request.current = true; setOpening(true); setError("");
    try {
      const response = await fetch("/api/accounts/discord/search", { method: "POST", signal: AbortSignal.timeout(10_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open Discord sign-in.");
      setStatus({ state: "waiting", canLaunch: true, detail: "Finish signing in in the Discord window. This screen updates automatically." });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open Discord sign-in. Try again."); }
    finally { request.current = false; setOpening(false); }
  }

  const saved = status.state === "connected" && status.accountId;
  useEffect(() => { onSaved?.(!!saved); }, [saved, onSaved]);
  return <div className="space-y-4 text-sm">
    <div>
      <h4 className="font-semibold text-slate-800 dark:text-neutral-100">Search your Discord messages</h4>
      <p className="mt-2 leading-relaxed text-slate-500 dark:text-neutral-400">Private DMs and group DMs are searchable here. New messages sync live; the last 90 days load gradually. Server channels, sending, and reactions stay in Discord.</p>
    </div>
    {saved ? <ConnectionProgress platform="discord" accountId={status.accountId!} /> : <ol className="list-inside list-decimal space-y-3 rounded-xl bg-slate-50 p-4 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
      <li>Use this app on the computer running sync, with <b>Google Chrome installed</b>. Click <b>Open Discord sign-in</b> below.</li>
      <li>In the Discord window, sign in normally, or scan its QR: Discord on your phone → <b>You → Settings → Scan QR Code</b>. Approve only the login you just started. Complete any security check in Discord.</li>
      <li>Wait for this app to confirm the account. The sign-in window closes automatically. Search your inbox and filter to <b>Discord</b>; use <b>Open in Discord</b> to reply.</li>
    </ol>}
    {!saved && <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">Discord blocks iframe login. Sign-in opens in a separate window on this computer, not inside the Discord desktop app. An existing desktop login does not automatically connect this app. You never need to copy a token.</p>}
    <button type="button" onClick={connect} disabled={opening || !isLocal || status.state === "checking" || status.canLaunch === false} aria-busy={opening}
      className={`${saved ? setupSecondary : setupButton} w-full`}>
      {opening ? "Opening Discord…" : status.state === "checking" && isLocal ? "Checking setup…" : saved ? "Sign in again or switch account" : ["waiting", "starting"].includes(status.state) ? "Show Discord sign-in window" : "Open Discord sign-in"}
    </button>
    {(!isLocal || status.canLaunch === false) && <p role="status" className="text-sm text-slate-500 dark:text-neutral-400">{!isLocal ? "Sign-in currently requires the app on its host computer, with a desktop and Chrome. It cannot open a login window on your device from a headless VPS." : status.reason}</p>}
    {!saved && status.detail && <p role="status" aria-live="polite" className="text-sm text-slate-600 dark:text-neutral-300">{status.detail}</p>}
    {error && <SetupError>{error}</SetupError>}
    <details className="text-xs text-slate-500 dark:text-neutral-400">
      <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Privacy and connection limitations</summary>
      <p className="mt-2 leading-relaxed">Personal-account indexing is unofficial and can carry Discord account restrictions. Login is encrypted locally, your existing archive is preserved, and indexing never triggers automated replies. A closed or expired sign-in can be reopened above; do not share login QR codes.</p>
    </details>
  </div>;
}
