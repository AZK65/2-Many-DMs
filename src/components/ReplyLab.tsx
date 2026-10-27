"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { WorkspaceHeader } from "./WorkspaceHeader";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  RefreshIcon,
  SendIcon,
  SparklesIcon,
  TrashIcon,
} from "./icons";

type VoiceProfile = {
  lookbackDays: number;
  since: string;
  messageCount: number;
  outboundCount: number;
  conversationCount: number;
  exampleCount: number;
  styleSignals: string[];
  model: string;
  modelAvailable: boolean;
  modelDetail: string;
};

type Turn = {
  id: string;
  role: "customer" | "assistant";
  text: string;
  examplesUsed?: number;
  source?: "proven_reply" | "composed" | "needs_confirmation";
  confidence?: "high" | "medium" | "low";
  warning?: string;
};

const STARTERS = [
  "Hey, how soon can we get started?",
  "I already sent this yesterday. Any update?",
  "Can you explain what I need to do next?",
];

function id() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ReplyLab() {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai-replies/profile", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Voice profile could not be loaded.");
        setProfile(body as VoiceProfile);
      })
      .catch((error: Error) => setProfileError(error.message));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, drafting]);

  async function requestDraft(nextTurns: Turn[], customerMessage: string) {
    setDrafting(true);
    setDraftError(null);
    try {
      const response = await fetch("/api/ai-replies/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: customerMessage,
          history: nextTurns.map(({ role, text }) => ({ role, text })),
        }),
      });
      const body = (await response.json()) as {
        draft?: string;
        examplesUsed?: number;
        source?: "proven_reply" | "composed" | "needs_confirmation";
        confidence?: "high" | "medium" | "low";
        warning?: string;
        error?: string;
      };
      if (!response.ok || !body.draft) throw new Error(body.error || "A reply could not be drafted.");
      setTurns([
        ...nextTurns,
        {
          id: id(),
          role: "assistant",
          text: body.draft,
          examplesUsed: body.examplesUsed,
          source: body.source,
          confidence: body.confidence,
          warning: body.warning,
        },
      ]);
    } catch (error) {
      setTurns(nextTurns);
      setDraftError(error instanceof Error ? error.message : "A reply could not be drafted.");
    } finally {
      setDrafting(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || drafting) return;
    const nextTurns = [...turns, { id: id(), role: "customer" as const, text: message }];
    setTurns(nextTurns);
    setInput("");
    void requestDraft(nextTurns, message);
  }

  function regenerate() {
    if (drafting) return;
    const withoutLastDraft = turns.at(-1)?.role === "assistant" ? turns.slice(0, -1) : turns;
    const customer = [...withoutLastDraft].reverse().find((turn) => turn.role === "customer");
    if (!customer) return;
    setTurns(withoutLastDraft);
    void requestDraft(withoutLastDraft, customer.text);
  }

  async function copy(turn: Turn) {
    await navigator.clipboard.writeText(turn.text);
    setCopiedId(turn.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="workspace-page flex h-[100dvh] flex-col overflow-hidden bg-slate-100 dark:bg-black">
      <WorkspaceHeader />
      <div className="mx-auto w-full max-w-6xl px-4 pt-4"><h1 className="text-xl font-semibold tracking-tight">Reply Lab</h1><p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Test your voice without sending anything.</p></div>

      <main className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-rows-[12rem_minmax(0,1fr)] gap-4 p-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="scroll-thin overflow-y-auto rounded-2xl bg-white p-5 ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-accent">YOUR VOICE</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Last 30 days</h2>
            </div>
            <span
              className={`mt-1 h-2.5 w-2.5 rounded-full ${profile?.modelAvailable ? "bg-accent" : "bg-amber-500"}`}
              aria-label={profile?.modelAvailable ? "AI ready" : "AI needs attention"}
            />
          </div>

          {!profile && !profileError && (
            <div className="mt-6 space-y-3" aria-label="Loading voice profile">
              {["w-full", "w-5/6", "w-4/6"].map((width) => (
                <div key={width} className={`h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-neutral-800 ${width}`} />
              ))}
            </div>
          )}
          {profileError && (
            <p className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{profileError}</p>
          )}
          {profile && (
            <>
              <div className="mt-6 grid grid-cols-2 gap-4 border-b border-slate-100 pb-5 dark:border-neutral-800">
                <div>
                  <div className="tabular-nums text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{profile.outboundCount.toLocaleString()}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-neutral-500">sent messages</div>
                </div>
                <div>
                  <div className="tabular-nums text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{profile.conversationCount.toLocaleString()}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-neutral-500">conversations</div>
                </div>
              </div>

              <section className="py-5">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">What it picked up</h3>
                <ul className="mt-3 space-y-3">
                  {profile.styleSignals.map((signal) => (
                    <li key={signal} className="flex gap-2.5 text-sm text-slate-600 dark:text-neutral-400">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span>{signal}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="rounded-xl bg-slate-50 p-3 dark:bg-[#1F1F1F]">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-neutral-300">
                  <span className={`h-2 w-2 rounded-full ${profile.modelAvailable ? "bg-accent" : "bg-amber-500"}`} />
                  {profile.modelAvailable ? "Ready to draft" : "Setup needed"}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-neutral-500">{profile.modelDetail}. Your messages stay on this Mac.</p>
              </div>
            </>
          )}
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-800" aria-label="Reply testing chat">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-neutral-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Act like a customer</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-500">The AI answers as you. Every answer stays editable.</p>
            </div>
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => { setTurns([]); setDraftError(null); }}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-500 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-800 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <TrashIcon className="h-4 w-4" />
                Clear
              </button>
            )}
          </div>

          <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
            {turns.length === 0 ? (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-neutral-200">
                  <SparklesIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Put your usual questions to the test</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-neutral-400">Type what a customer might say. The draft will look for similar questions you already answered, then match how you wrote back.</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => setInput(starter)}
                      className="rounded-lg bg-slate-100 px-3 py-2 text-left text-xs font-medium text-slate-600 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-200 hover:text-slate-900 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-6">
                <AnimatePresence initial={false}>
                  {turns.map((turn) => (
                    <motion.article
                      key={turn.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                      className={turn.role === "customer" ? "ml-auto max-w-[82%]" : "mr-auto w-full max-w-[88%]"}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
                        <span className="text-xs font-semibold text-slate-400 dark:text-neutral-500">
                          {turn.role === "customer" ? "Customer" : "Your draft"}
                        </span>
                        {turn.role === "assistant" && (
                          <button
                            type="button"
                            onClick={() => void copy(turn)}
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-500 dark:hover:text-neutral-200"
                          >
                            {copiedId === turn.id ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                            {copiedId === turn.id ? "Copied" : "Copy"}
                          </button>
                        )}
                      </div>
                      {turn.role === "customer" ? (
                        <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm leading-6 text-white dark:bg-neutral-100 dark:text-neutral-900">{turn.text}</div>
                      ) : (
                        <div className="rounded-2xl rounded-bl-md bg-slate-100 p-1 dark:bg-[#272727]">
                          <textarea
                            value={turn.text}
                            onChange={(event) => setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, text: event.target.value } : item))}
                            rows={Math.max(2, turn.text.split("\n").length)}
                            aria-label="Editable AI draft"
                            className="max-h-48 w-full resize-y bg-transparent px-3 py-2 text-sm leading-6 text-slate-800 outline-none dark:text-neutral-100"
                          />
                          <div className="flex items-center justify-between px-3 pb-2 text-xs text-slate-400 dark:text-neutral-500">
                            <span>
                              {turn.source === "needs_confirmation"
                                ? "Held back an unverified fact"
                                : turn.source === "proven_reply"
                                  ? "Reused an established answer"
                                : turn.examplesUsed
                                  ? `Used ${turn.examplesUsed} close ${turn.examplesUsed === 1 ? "match" : "matches"}`
                                  : "Composed in your recent voice"}
                            </span>
                            {turn === turns.at(-1) && (
                              <button type="button" onClick={regenerate} className="flex items-center gap-1.5 font-medium transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:text-neutral-200">
                                <RefreshIcon className="h-3.5 w-3.5" />
                                Try another
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </motion.article>
                  ))}
                </AnimatePresence>
                {drafting && (
                  <div className="mr-auto max-w-[88%]">
                    <div className="mb-1.5 px-1 text-xs font-semibold text-slate-400 dark:text-neutral-500">Your draft</div>
                    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100 px-4 py-4 dark:bg-[#272727]">
                      {[0, 1, 2].map((dot) => (
                        <motion.span key={dot} className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-neutral-500" animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: dot * 0.15 }} />
                      ))}
                      <span className="ml-1 text-xs text-slate-500 dark:text-neutral-400">Looking through similar replies…</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={submit} className="shrink-0 border-t border-slate-100 p-4 dark:border-neutral-800">
            {draftError && <div className="mx-auto mb-3 max-w-2xl rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{draftError}</div>}
            <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl bg-slate-100 p-2 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-accent/40 dark:bg-[#1F1F1F] dark:ring-neutral-700 dark:focus-within:bg-[#1F1F1F]">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder="Type a customer message…"
                aria-label="Customer test message"
                className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="submit"
                disabled={!input.trim() || drafting || profile?.modelAvailable === false}
                aria-label="Generate reply"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40 dark:focus-visible:ring-offset-[#1F1F1F]"
              >
                <SendIcon className="h-[18px] w-[18px]" />
              </motion.button>
            </div>
            <p className="mx-auto mt-2 max-w-2xl px-2 text-center text-xs text-slate-400 dark:text-neutral-600">Drafts can be wrong. Review details before using one.</p>
          </form>
        </section>
      </main>
    </div>
  );
}
