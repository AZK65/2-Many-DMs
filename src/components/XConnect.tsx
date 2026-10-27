"use client";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { ConnectShell, ConnectionProgress, SetupError, setupButton, setupSecondary } from "./ConnectSetup";

export function XConnect({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [step, setStep] = useState(0); const [code, setCode] = useState(""); const [expiresAt, setExpiresAt] = useState(0);
  const [accountId, setAccountId] = useState(""); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [copied, setCopied] = useState(""); const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  async function pairing() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try {
      const data = await fetchJson<{ code: string; expiresAt: number }>("/api/accounts/pair", { method: "POST", signal: AbortSignal.timeout(8000) }, "Pairing code");
      setCode(data.code); setExpiresAt(data.expiresAt); setStep(1);
    } catch { setError("Could not create a pairing code. Check your server connection and try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!code || accountId) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await fetchJson<{ expired?: boolean; accountId?: string }>(`/api/accounts/pair?code=${encodeURIComponent(code)}`, { cache: "no-store", signal: AbortSignal.timeout(6000) }, "X pairing status");
        if (!stopped) {
          setError("");
          if (data.accountId) { setAccountId(data.accountId); setStep(2); return; }
          if (data.expired) { setExpiresAt(0); return; }
        }
      } catch { if (!stopped) setError("Cannot check pairing yet. Keep this screen open; checking again shortly."); }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [code, accountId]);
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch { setCopied(""); setError("Clipboard access is unavailable. Select and copy the text below instead."); }
  }
  const expired = expiresAt <= now;
  return <ConnectShell platform="x" subtitle="Link the X account you use in your browser." steps={["Connector", "Pair", "Sync"]} current={step} busy={busy} onClose={onClose}>
    {step === 0 && <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-neutral-800">
        <h3 className="font-semibold">One small browser connector</h3>
        <p className="mt-2 text-slate-500 dark:text-neutral-400">Use Chrome or Edge on a computer. Sign in to X yourself; you do not give 2manydms your X password.</p>
        <ol className="mt-4 list-inside list-decimal space-y-3">
          <li><a href="/api/accounts/x/extension" download className="font-medium text-accent underline">Download the connector</a> and unzip it.</li>
          <li>Open <code className="select-all">chrome://extensions</code> (or <code className="select-all">edge://extensions</code>). Turn on <b>Developer mode</b>, choose <b>Load unpacked</b>, and select the unzipped folder.</li>
          <li><a href="https://x.com" target="_blank" rel="noreferrer" className="font-medium text-accent underline">Open X ↗</a> and sign in to the account you want to connect.</li>
        </ol>
      </div>
      <p className="text-xs text-slate-500 dark:text-neutral-400">This uses your browser session, not an official X DM integration. X can require a security check or pause requests. Rate limits remain respected.</p>
      <button className={`${setupButton} w-full`} onClick={pairing} disabled={busy}>{busy ? "Preparing pairing…" : "Connector installed. Continue"}</button>
    </div>}
    {step === 1 && <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-neutral-400">Open <b>2 Many DMs — Connect X</b> from your browser’s extensions menu. Paste these two values, then click <b>Connect my X account</b>.</p>
      {[{ label: "App URL", value: origin }, { label: "Pairing code", value: code }].map(item => <div key={item.label} className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-800">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500">{item.label}</span><button className={setupSecondary} disabled={item.label === "Pairing code" && expired} onClick={() => copy(item.value, item.label)}>{copied === item.label ? "Copied" : `Copy ${item.label.toLowerCase()}`}</button></div>
        <p className="break-all font-mono text-base select-all">{item.value}</p>
      </div>)}
      <p role="status" className="text-xs tabular-nums text-slate-500 dark:text-neutral-400">{expired ? "Code expired. Generate a fresh one below." : `Waiting for the extension. Code expires in ${Math.ceil((expiresAt - now) / 60000)} min.`}</p>
      <div className="flex justify-between gap-2"><button className={setupSecondary} onClick={() => setStep(0)}>Installation help</button><button className={setupSecondary} onClick={pairing} disabled={busy}>{busy ? "Preparing…" : "New pairing code"}</button></div>
      <p className="text-xs text-slate-500 dark:text-neutral-400">Keep the pairing code private. The connector sends the session only to the App URL you enter. If you use a VPS, open your private owner connection, not the public marketing site.</p>
    </div>}
    {step === 2 && <><ConnectionProgress platform="x" accountId={accountId} onReady={onConnected} /><button className={`${setupButton} mt-6 w-full`} onClick={onClose}>Done</button></>}
    {error && <SetupError>{error}</SetupError>}
  </ConnectShell>;
}
