"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { SparklesIcon, CloseIcon, SendIcon } from "./icons";
import { aiRequest, type AISettings } from "./AISetup";
import type { AssistantSource } from "@/lib/chat-assistant";

type Turn = { role: "user" | "assistant"; content: string; sources?: AssistantSource[] };
export function ChatAssistant({ conversation, onOpenConversation, onOpenSettings }: {
  conversation?: { id: string; contact: { name: string } } | null;
  onOpenConversation?: (id: string, messageId: string) => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const reduceMotion = useReducedMotion();
  const scopeId = scope === "chat" ? conversation?.id : undefined;
  useEffect(() => {
    controller.current?.abort(); controller.current = null;
    setBusy(false); setTurns([]); setError("");
  }, [scopeId]);
  useEffect(() => () => controller.current?.abort(), []);
  async function loadSettings() {
    setLoading(true); setError("");
    try { setSettings(await aiRequest<AISettings>("/api/assistant/settings")); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) void loadSettings(); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "end" }); }, [turns, busy, reduceMotion]);
  async function ask(value = question) {
    const prompt = value.trim();
    if (!prompt || busy || !settings?.configured) return;
    const previous = turns;
    setTurns([...previous, { role: "user", content: prompt }]); setQuestion(""); setError(""); setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await aiRequest<{ answer: string; sources: AssistantSource[] }>("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(70_000)]),
        body: JSON.stringify({ question: prompt, history: previous.slice(-6).map(({ role, content }) => ({ role, content })), conversationId: scopeId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      if (controller.current === abort) setTurns([...previous, { role: "user", content: prompt }, { role: "assistant", content: result.answer, sources: result.sources }]);
    } catch (err) {
      if (controller.current === abort) { setTurns(previous); setQuestion(prompt); setError(abort.signal.aborted ? "Stopped. Your question is ready to try again." : (err as Error).message); }
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); input.current?.focus(); } }
  }
  const configure = () => { setOpen(false); onOpenSettings(); };
  const openSource = (source: AssistantSource) => {
    setOpen(false);
    if (onOpenConversation) onOpenConversation(source.conversationId, source.messageId);
    else window.location.assign(`/?conversation=${encodeURIComponent(source.conversationId)}&message=${encodeURIComponent(source.messageId)}`);
  };
  return <>
    <button type="button" onClick={() => setOpen(true)} title="AI assistant" aria-label="Open AI assistant" aria-haspopup="dialog" className="rail-control"><SparklesIcon className="h-5 w-5" /></button>
    <AnimatePresence>{open && <OverlayPortal onClose={() => setOpen(false)}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <motion.section role="dialog" aria-modal="true" aria-labelledby="chat-assistant-title" initial={{ opacity: 0, x: reduceMotion ? 0 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduceMotion ? 0 : 24 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl sm:inset-y-4 sm:right-4 sm:rounded-2xl sm:border dark:border-neutral-800 dark:bg-neutral-900">
        <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-neutral-800">
          <SparklesIcon className="h-5 w-5 text-accent" /><div className="min-w-0 flex-1"><h2 id="chat-assistant-title" className="font-semibold">Ask your chats</h2><p className="text-xs text-slate-500">Find the context. Keep the conversation.</p></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close AI assistant" className="rail-control"><CloseIcon className="h-4 w-4" /></button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs dark:border-neutral-800">
          <label htmlFor="assistant-scope" className="text-slate-500">Search</label><select id="assistant-scope" value={conversation ? scope : "all"} disabled={busy} onChange={event => setScope(event.target.value)} className="min-w-0 max-w-[65%] rounded-lg bg-slate-100 px-2 py-1.5 outline-accent dark:bg-neutral-800"><option value="all">All synced chats</option>{conversation && <option value="chat">This chat · {conversation.contact.name}</option>}</select>
          <button type="button" disabled={busy} onClick={() => { setTurns([]); setError(""); }} className="ml-auto rounded px-2 py-1 text-slate-500 hover:text-accent disabled:opacity-40">Clear</button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading ? <p role="status" className="text-sm text-slate-500">Checking AI connection…</p> : !settings?.configured ? <div className="py-8"><h3 className="text-lg font-semibold">Your inbox, with answers.</h3><p className="mb-5 mt-2 text-sm leading-relaxed text-slate-500">Connect your own OpenRouter key to ask about synced messages across your accounts. AI is optional; search and messaging work without it.</p><button type="button" onClick={configure} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg">Set up AI assistant</button>{!settings && <button type="button" onClick={() => void loadSettings()} className="ml-3 p-2 text-sm text-accent">Retry</button>}</div> : <>
            {!turns.length && <div className="py-5"><h3 className="text-lg font-semibold">What would you like to find?</h3><p className="mb-5 mt-2 text-sm text-slate-500">Search for details, summarize discussions, or draft a reply. Nothing is sent automatically.</p><div className="space-y-2">{["What have people discussed recently?", "Find messages where someone shared an email", "What did I promise to follow up on this week?"].map(prompt => <button type="button" key={prompt} disabled={busy} onClick={() => void ask(prompt)} className="block w-full rounded-xl bg-slate-50 px-4 py-3 text-left text-sm transition hover:bg-slate-100 focus-visible:outline-accent disabled:opacity-40 dark:bg-neutral-800 dark:hover:bg-neutral-700">{prompt}</button>)}</div></div>}
            <div role="log" aria-live="polite" className="space-y-6">{turns.map((turn, index) => <article key={index} className={turn.role === "user" ? "ml-8 rounded-xl bg-slate-100 p-3 dark:bg-neutral-800" : ""}><div className="mb-2 text-xs font-medium text-slate-400">{turn.role === "user" ? "You" : "AI assistant"}</div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{turn.content}</p>{!!turn.sources?.length && <div className="mt-4 space-y-2">{turn.sources.map(source => <button type="button" key={source.ref} onClick={() => openSource(source)} className="block w-full rounded-lg border border-slate-200 p-3 text-left text-xs transition hover:bg-slate-50 focus-visible:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-800"><span className="block font-medium text-accent">[{source.ref}] {source.name} · {source.platform}</span><span className="mt-1 block text-slate-400">{source.speaker} · {new Date(source.sentAt).toLocaleString()}</span><span className="mt-1 block line-clamp-2 break-words text-slate-500">{source.snippet}</span></button>)}</div>}</article>)}</div>
          </>}
          {busy && <p role="status" className="mt-5 animate-pulse text-sm text-slate-500 motion-reduce:animate-none">Searching synced chats and preparing your answer…</p>}
          {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}<div ref={end} />
        </div>
        <footer className="border-t border-slate-100 p-4 dark:border-neutral-800">
          <form onSubmit={event => { event.preventDefault(); void ask(); }} className="flex items-end gap-2 rounded-xl bg-slate-100 p-2 focus-within:ring-2 focus-within:ring-accent/40 dark:bg-neutral-800">
            <textarea ref={input} rows={2} maxLength={3000} value={question} onChange={event => setQuestion(event.target.value)} disabled={!settings?.configured || busy} aria-label="Ask your chats" placeholder="Ask anything about your chats…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }} className="max-h-40 min-h-10 w-full resize-y bg-transparent p-2 text-sm outline-none disabled:opacity-40" />
            {busy ? <button type="button" onClick={() => controller.current?.abort()} className="rounded-lg px-3 py-2 text-sm text-accent">Stop</button> : <button type="submit" aria-label="Ask assistant" disabled={!question.trim() || !settings?.configured || loading} className="rounded-lg bg-accent p-2.5 text-accent-fg disabled:opacity-30"><SendIcon className="h-4 w-4" /></button>}
          </form>
          <div className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-slate-400"><span className="flex-1">Relevant excerpts go to OpenRouter. Synced history may be incomplete. Check sources before acting.</span><button type="button" disabled={busy} onClick={configure} className="shrink-0 rounded px-1 text-accent disabled:opacity-40">AI settings</button></div>
        </footer>
      </motion.section>
    </OverlayPortal>}</AnimatePresence>
  </>;
}
