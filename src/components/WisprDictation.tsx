"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, MicrophoneIcon } from "./icons";
import { WISPR_SETUP_KEY, WISPR_TOKEN_KEY, wisprRequest, wisprSetupProblem, type WisprStatus } from "@/lib/wispr-bridge";

const control = "rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:hover:bg-neutral-700";

export function WisprDictation({ conversationId, onInsert }: { conversationId: string; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [configured, setConfigured] = useState(false);
  const [paired, setPaired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const storageKey = `omni:wispr-draft:${conversationId}`;
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  useEffect(() => {
    active.current = open;
    if (!open) return;
    setText(localStorage.getItem(storageKey) || "");
    setConfigured(localStorage.getItem(WISPR_SETUP_KEY) === "true");
    setPaired(!!localStorage.getItem(WISPR_TOKEN_KEY));
    dialog.current?.focus();
    return () => { active.current = false; };
  }, [open, storageKey]);

  async function check(start = false) {
    if (inFlight.current) return;
    const generation = epoch.current;
    const current = () => active.current && epoch.current === generation;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const token = localStorage.getItem(WISPR_TOKEN_KEY);
      if (!token) throw Error("Pair this Omni address using the code in the helper’s menu bar.");
      const status = await wisprRequest<WisprStatus>("status", {}, token);
      const problem = wisprSetupProblem(status);
      if (problem) throw Error(problem);
      if (localStorage.getItem(WISPR_SETUP_KEY) !== "true") throw Error("Complete the shortcut checklist below first.");
      if (!current()) return;
      setReady(true);
      if (start) {
        // Let React reveal the labelled field before requesting a shortcut.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!current()) return;
        field.current?.focus();
        field.current?.setSelectionRange(field.current.value.length, field.current.value.length);
        await wisprRequest("toggle", { requestId: crypto.randomUUID() }, token);
        if (current()) setNotice("Shortcut sent. Speak after Wispr’s ping. Use its Flow Bar to confirm whether it’s listening.");
      }
    } catch (reason) {
      if (current()) {
        setPaired(!!localStorage.getItem(WISPR_TOKEN_KEY));
        setError(reason instanceof Error ? reason.message : "Dictation unavailable.");
      }
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }

  async function pair() {
    if (inFlight.current) return;
    const generation = epoch.current;
    const current = () => active.current && epoch.current === generation;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await wisprRequest<{ token: string }>("pair", { code });
      localStorage.setItem(WISPR_TOKEN_KEY, result.token);
      if (current()) { setPaired(true); setCode(""); setNotice("This Omni address is paired with your Mac."); }
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "Pairing failed."); }
    finally { inFlight.current = false; if (current()) setBusy(false); }
  }

  function close() {
    // Never guess Wispr's recording state or blindly toggle it during cleanup.
    // The user stops in Flow; only text already pasted here is retained locally.
    epoch.current++; active.current = false; setOpen(false); setReady(false); setBusy(false);
    trigger.current?.focus();
  }

  return <>
    <button ref={trigger} type="button" aria-label="Dictate with Wispr Flow" title="Dictate with Wispr Flow" aria-haspopup="dialog" onClick={() => {
      epoch.current++; setError(null); setNotice(""); setOpen(true); active.current = true;
      if (isMac && localStorage.getItem(WISPR_TOKEN_KEY) && localStorage.getItem(WISPR_SETUP_KEY) === "true") void check(true);
    }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-accent/10 hover:text-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <MicrophoneIcon className="h-[18px] w-[18px]" />
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wispr-title" aria-describedby="wispr-help" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea") || []);
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
        // Enter stays a newline in the dictation box, never a send action.
        event.stopPropagation();
      }} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
        <div className="flex items-center justify-between gap-3">
          <h2 id="wispr-title" className="text-base font-semibold">Dictate with Wispr Flow</h2>
          <button type="button" onClick={close} aria-label="Close dictation" className={control}><CloseIcon /></button>
        </div>
        <p id="wispr-help" className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">Speak into Wispr, review the text, then insert it into this chat. Nothing sends automatically. Stop Wispr’s Flow Bar before closing.</p>
        {!isMac ? <p role="status" className="mt-4 text-sm">This helper requires a Mac. On other devices, you can use Wispr’s own keyboard or app to dictate into the regular message field.</p> : !ready ? <div className="mt-4 space-y-4 text-sm">
          <ol className="list-decimal space-y-3 pl-5">
            <li>Install and open <a className="text-accent underline" href="https://wisprflow.ai/downloads" target="_blank" rel="noreferrer">Wispr Flow</a>. Sign in and finish its microphone and Accessibility setup.</li>
            <li><a className="text-accent underline" href="/api/desktop/dictation-download">Download Omni Dictation for Mac</a>, unzip it, then run <strong>Install.command</strong>. The helper stays on your Mac, including when Omni runs on a VPS.</li>
            <li>In the helper’s menu-bar mic, choose <strong>Accessibility permission</strong> and enable Omni Dictation in macOS settings.</li>
            <li>In Wispr → Settings → General → Shortcuts, add <strong>Control + Option + Space</strong> for hands-free dictation. Keep Wispr’s experimental “Press Enter” command off.</li>
          </ol>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={configured} onChange={e => { setConfigured(e.target.checked); localStorage.setItem(WISPR_SETUP_KEY, String(e.target.checked)); }} className="mt-0.5 accent-accent" /><span>I configured the hands-free shortcut and disabled automatic Enter.</span></label>
          {!paired ? <div className="rounded-xl bg-slate-50 p-3 dark:bg-neutral-800">
            <label htmlFor="wispr-code" className="block text-xs">Helper menu → Pair Omni on this Mac → enter its six-digit code here.</label>
            <div className="mt-2 flex gap-2"><input id="wispr-code" value={code} inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6-digit code" onChange={e => setCode(e.target.value.replace(/\D/g, ""))} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-neutral-600 dark:bg-neutral-900" /><button type="button" disabled={busy || code.length !== 6} onClick={() => void pair()} className={control}>Pair Mac</button></div>
          </div> : <p className="text-xs text-accent">Paired with this browser’s Omni address. <button className="underline" onClick={() => { localStorage.removeItem(WISPR_TOKEN_KEY); setPaired(false); }}>Pair again</button></p>}
          <button type="button" disabled={busy || !paired || !configured} onClick={() => void check(true)} className={`${control} w-full bg-accent text-accent-fg hover:opacity-90`}>{busy ? "Checking helper…" : "Check setup & start dictation"}</button>
        </div> : <div className="mt-4">
          <textarea ref={field} value={text} aria-label="Omni Wispr dictation draft" placeholder="Wispr’s words will appear here…" rows={6} onChange={e => { setText(e.target.value); localStorage.setItem(storageKey, e.target.value); }} className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-800" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button type="button" disabled={busy} onClick={() => void check(true)} className={control}>{busy ? "Sending shortcut…" : "Start / stop Wispr"}</button>
            <button type="button" disabled={busy || !text.trim()} onClick={() => { onInsert(text.trim()); localStorage.removeItem(storageKey); setText(""); close(); }} className={`${control} bg-accent text-accent-fg hover:opacity-90`}>Insert into draft</button>
          </div>
          <button type="button" className={`${control} mt-2 text-xs text-slate-500`} onClick={() => setReady(false)}>Dictation setup</button>
        </div>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {notice && !error && <p role="status" className="mt-3 text-xs text-slate-500 dark:text-neutral-400">{notice}</p>}
      </div>
    </div>, document.body)}
  </>;
}
