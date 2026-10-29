"use client";

import { useEffect, useId, useState } from "react";
import { ExternalLinkIcon, CheckCircleIcon } from "./icons";

export type AISettings = { configured: boolean; model: string };
export async function aiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, signal: init?.signal || AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "Could not reach the assistant. Please try again.");
  return data;
}

export function AISetup({ onContinue, onSkip }: { onContinue?: () => void; onSkip?: () => void }) {
  const id = useId();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { setSettings(await aiRequest<AISettings>("/api/assistant/settings")); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function save(remove = false) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setSettings(await aiRequest<AISettings>("/api/assistant/settings", { method: remove ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" }, ...(remove ? {} : { body: JSON.stringify({ apiKey: key.trim(), consent }) }) }));
      setKey(""); setConsent(false); setNotice(remove ? "Key removed. Your chats are unchanged." : "OpenRouter connected. Your key is saved securely.");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5 text-sm">
    <p className="text-slate-500 dark:text-neutral-400">Find an email, catch up on a group, or ask what you promised someone. Answers link back to the synced messages they use. Nothing is sent to your contacts.</p>
    {loading ? <p role="status" className="text-slate-500">Checking AI setup…</p> : settings ? <>
      {settings.configured && <div className="flex items-center gap-2 rounded-xl bg-accent/10 p-3 text-accent"><CheckCircleIcon className="h-5 w-5" /><span>OpenRouter connected · GPT-4.1 Mini</span></div>}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div><a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent underline underline-offset-4">Create an OpenRouter key<ExternalLinkIcon className="h-3.5 w-3.5" /></a>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">Sign in, add credits, then create a key with a spending limit you’re comfortable with. OpenRouter bills usage separately. You can skip AI and use the inbox normally.</p></div>
        <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
          <label htmlFor={`${id}-key`} className="block font-medium">{settings.configured ? "Replace API key" : "OpenRouter API key"}</label>
          <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={key} maxLength={256} onChange={event => setKey(event.target.value)} placeholder={settings.configured ? "Paste a new key to replace the saved one" : "Paste your OpenRouter key"} disabled={busy} className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent dark:border-neutral-700" />
          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500 dark:text-neutral-400"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} className="mt-0.5 accent-accent" /><span>I understand that when I ask a question, my question and relevant chat excerpts are sent to OpenRouter and its AI provider. Requests require no-training and zero-retention provider routing.</span></label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy || !key.trim() || !consent} className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-fg transition hover:opacity-90 focus-visible:outline-accent disabled:opacity-40">{busy ? "Saving…" : settings.configured ? "Replace key" : "Connect AI"}</button>
            {settings.configured && <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-lg px-2 py-2 text-slate-500 hover:text-red-500 focus-visible:outline-accent disabled:opacity-40">Remove saved key</button>}
          </div>
        </form>
        <p className="text-xs text-slate-400">Encrypted on your server, never saved in browser storage. Only synced text and indexed image text are searchable; missing history may need syncing first.</p>
      </div>
    </> : <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-2">Retry loading settings</button>}
    {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    {notice && <p role="status" className="text-accent">{notice}</p>}
    {onSkip && <div className="flex items-center justify-end gap-3">
      <button type="button" disabled={busy} onClick={onSkip} className="rounded-lg px-4 py-2.5 text-slate-500 transition hover:bg-slate-100 focus-visible:outline-accent disabled:opacity-40 dark:hover:bg-neutral-800">Skip for now</button>
      {settings?.configured && <button type="button" disabled={busy} onClick={onContinue} className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-fg disabled:opacity-40">Continue</button>}
    </div>}
  </div>;
}
