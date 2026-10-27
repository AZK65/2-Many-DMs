"use client";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { normalizeTelegramPhone, telegramCredentials, type SetupError as LoginError } from "@/lib/connection-setup";
import { ConnectShell, ConnectionProgress, SetupError, SetupField, setupButton, setupSecondary } from "./ConnectSetup";

type Step = "checking" | "app" | "phone" | "code" | "password" | "saved";
export function TelegramConnect({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [step, setStep] = useState<Step>("checking");
  const [apiId, setApiId] = useState(""); const [apiHash, setApiHash] = useState("");
  const [customApp, setCustomApp] = useState(false);
  const [phone, setPhone] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState("");
  const [loginId, setLoginId] = useState(""); const [accountId, setAccountId] = useState("");
  const [delivery, setDelivery] = useState("app");
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [retryAt, setRetryAt] = useState(0); const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now()); const [storageReady, setStorageReady] = useState(true);
  const loginRef = useRef("");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function check() {
    setError(null); setStep("checking");
    try {
      const data = await fetchJson<{ configured: boolean; storageReady: boolean }>("/api/telegram/login/start", { signal: AbortSignal.timeout(8000) }, "Telegram setup");
      setStorageReady(data.storageReady); setCustomApp(!data.configured); setStep(data.configured ? "phone" : "app");
    } catch { setError({ error: "Could not check Telegram setup. Make sure the server is reachable, then retry." }); }
  }
  useEffect(() => { void check(); return () => { if (loginRef.current) void fetch("/api/telegram/login/start", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId: loginRef.current }), keepalive: true }).catch(() => {}); }; }, []);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const expired = expiresAt > 0 && now >= expiresAt;
  async function request(verify = false) {
    if (inFlight.current || wait > 0) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/telegram/login/${verify ? "verify" : "start"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(40_000),
        body: JSON.stringify(verify ? { loginId, code, ...(step === "password" ? { password } : {}) }
          : { phone: normalizeTelegramPhone(phone), ...(customApp ? { apiId, apiHash } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError({ error: data.error || "The server could not finish sign in. Please try again.", action: data.action });
        if (data.retryAfter) setRetryAt(Date.now() + data.retryAfter * 1000);
        if (data.action === "credentials") { setCustomApp(true); setStep("app"); }
        return;
      }
      if (!verify) {
        setLoginId(data.loginId); loginRef.current = data.loginId;
        setExpiresAt(data.expiresAt); setDelivery(data.delivery); setCode(""); setPassword(""); setStep("code");
        // Resend is paced independently from verifying the code just received.
        setRetryAt(0); resendAfter.current = Date.now() + data.retryAfter * 1000;
      } else if (data.needsPassword) { setPassword(""); setStep("password"); }
      else {
        loginRef.current = ""; setPassword(""); setCode(""); setApiHash(""); setAccountId(data.accountId); setStep("saved");
      }
    } catch { setError({ error: "The server did not answer. Check your connection, then retry. If the code expired, request a new one." }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const resendAfter = useRef(0);
  const resendWait = Math.max(wait, Math.ceil((resendAfter.current - now) / 1000), 0);
  function restart() { setStep("phone"); setError(null); setCode(""); setPassword(""); setExpiresAt(0); setRetryAt(Math.max(retryAt, resendAfter.current)); }
  return <ConnectShell platform="telegram" subtitle="Your personal inbox, connected securely." steps={["App setup", "Sign in", "Sync"]} current={step === "app" || step === "checking" ? 0 : step === "saved" ? 2 : 1} busy={busy} onClose={onClose}>
    {step === "checking" && <div role="status" className="space-y-3"><p className="text-sm text-slate-500">Checking server setup…</p><div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-neutral-800" />{error && <button className={setupSecondary} onClick={check}>Retry setup check</button>}</div>}
    {!storageReady && <SetupError>The server needs secure storage before you sign in. Set APP_ENCRYPTION_KEY to a persistent 32 byte key and restart the app. Do not change an existing key.</SetupError>}
    {step === "app" && <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (telegramCredentials(apiId, apiHash)) { setError(null); setStep("phone"); } }}>
      <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-neutral-800">
        <h3 className="font-semibold">Create your Telegram app once</h3>
        <p className="mt-2 text-slate-500 dark:text-neutral-400">This is a personal Telegram connection, not a bot. Telegram requires an API ID and API hash.</p>
        <ol className="mt-3 list-inside list-decimal space-y-2">
          <li>Open <a className="text-accent underline" href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">Telegram API development tools ↗</a> and sign in with your phone.</li>
          <li>Create an app if you do not have one. Use a name such as “My messaging workspace” and a unique short name.</li>
          <li>Copy <b>App api_id</b> and <b>App api_hash</b> below.</li>
        </ol>
        <a className="mt-3 inline-block text-xs text-accent underline" href="https://core.telegram.org/api/obtaining_api_id" target="_blank" rel="noreferrer">Telegram’s official setup guide</a>
      </div>
      <SetupField label="API ID" inputMode="numeric" autoComplete="off" value={apiId} onChange={e => setApiId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 12345678" autoFocus />
      <SetupField label="API hash" type="password" autoComplete="off" value={apiHash} onChange={e => setApiHash(e.target.value.trim())} hint="32 characters. Keep this private. It is saved encrypted after you sign in, never in your browser storage." />
      <button className={`${setupButton} w-full`} disabled={!telegramCredentials(apiId, apiHash) || !storageReady}>Continue to sign in</button>
    </form>}
    {step === "phone" && <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (normalizeTelegramPhone(phone)) void request(); }}>
      <SetupField label="Telegram phone number" type="tel" autoComplete="tel" autoFocus value={phone} disabled={busy} onChange={e => setPhone(e.target.value)} placeholder="+1 202 555 0147" hint="Include + and your country code. Keep Telegram open on a device where you are already signed in." />
      <button className={`${setupButton} w-full`} disabled={!normalizeTelegramPhone(phone) || busy || wait > 0 || !storageReady}>{busy ? "Requesting your code…" : wait ? `Try again in ${wait}s` : "Send login code"}</button>
      <button className={setupSecondary} type="button" disabled={busy} onClick={() => { setCustomApp(true); setStep("app"); }}>Use different app credentials</button>
    </form>}
    {(step === "code" || step === "password") && <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!expired) void request(true); }}>
      <p className="text-sm text-slate-500 dark:text-neutral-400">{step === "code" ? `Check ${delivery === "app" ? "the Telegram service chat in your Telegram app" : "your phone"} for the latest code sent to ${phone}.` : "Telegram is asking for your two-step verification password."}</p>
      {step === "code" ? <SetupField label="Login code" key="code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} disabled={busy || expired} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} />
        : <SetupField label="Two-step verification password" key="password" autoFocus type="password" autoComplete="current-password" value={password} disabled={busy || expired} onChange={e => setPassword(e.target.value)} hint="This is not your phone unlock code. Forgotten password? Recover it in Telegram first." />}
      {expired ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">This login has expired. Request a new code below.</p>
        : <p className="text-xs text-slate-500 tabular-nums">Login expires in {Math.max(0, Math.ceil((expiresAt - now) / 60000))} min.</p>}
      <button className={`${setupButton} w-full`} disabled={busy || expired || wait > 0 || (step === "password" ? !password : !/^\d{4,8}$/.test(code))}>{busy ? "Verifying…" : wait ? `Try again in ${wait}s` : "Verify and connect"}</button>
      <div className="flex flex-wrap justify-between gap-2"><button type="button" disabled={busy || resendWait > 0} className={setupSecondary} onClick={() => void request()}>{resendWait > 0 ? `New code in ${resendWait}s` : "Send a new code"}</button><button type="button" disabled={busy} className={setupSecondary} onClick={restart}>Change phone number</button></div>
    </form>}
    {step === "saved" && <><ConnectionProgress platform="telegram" accountId={accountId} onReady={onConnected} /><button className={`${setupButton} mt-6 w-full`} onClick={onClose}>Done</button></>}
    {error && <SetupError>{error.error}{error.action === "restart" && <button type="button" className={`${setupSecondary} mt-2 block`} disabled={busy} onClick={restart}>Start again</button>}</SetupError>}
  </ConnectShell>;
}
