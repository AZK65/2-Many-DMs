"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { buildSetupPrompt, SETUP_ASSISTANTS, type SetupAssistant } from "@/lib/setup-prompt";
import { OverlayPortal } from "../OverlayPortal";
import { CheckIcon, CloseIcon, CopyIcon } from "../icons";

const SetupContext = createContext<() => void>(() => {});
export const useSetupPrompt = () => useContext(SetupContext);

export function GetStartedButton({ children = <>Get started <span aria-hidden>↗</span></>, className = "marketing-primary" }: { children?: ReactNode; className?: string }) {
  const open = useSetupPrompt();
  return <button type="button" onClick={open} className={className}>{children}</button>;
}

export function SetupPromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  function openSetup() { trigger.current = document.activeElement as HTMLElement; setOpen(true); }
  return <SetupContext.Provider value={openSetup}>{children}<AnimatePresence onExitComplete={() => {
    if (open) return;
    const target = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>('[aria-label="Open navigation"]');
    target?.focus({ preventScroll: true });
  }}>{open && <SetupPromptModal onClose={() => setOpen(false)} />}</AnimatePresence></SetupContext.Provider>;
}

function SetupPromptModal({ onClose }: { onClose: () => void }) {
  const [assistant, setAssistant] = useState<SetupAssistant>("Codex");
  const [includeModels, setIncludeModels] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [readPrompt, setReadPrompt] = useState(false);
  const prompt = buildSetupPrompt(assistant, includeModels);
  const currentPrompt = useRef(prompt);
  currentPrompt.current = prompt;
  const reduced = useReducedMotion();
  async function copy() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(prompt);
      if (currentPrompt.current === prompt) setCopyState("copied");
    } catch {
      if (currentPrompt.current !== prompt) return;
      setCopyState("error"); setReadPrompt(true);
    }
  }
  return <OverlayPortal onClose={onClose}>
    <motion.div className="marketing-dialog fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xl sm:p-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-description" className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl dark:bg-neutral-900 dark:text-neutral-100" initial={{ opacity: 0, y: reduced ? 0 : 24, scale: reduced ? 1 : 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : 16 }} transition={{ duration: reduced ? 0 : 0.5, ease: [0.32, 0.72, 0, 1] }}>
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-neutral-800"><span className="text-sm font-medium">Your workspace starts here.</span><button type="button" onClick={onClose} aria-label="Close setup guide" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors duration-200 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"><CloseIcon className="h-4 w-4" /></button></header>
        <div className="overflow-y-auto overscroll-contain p-6 sm:p-8">
          <h2 id="setup-title" className="text-3xl font-medium tracking-tight sm:text-4xl">Copy. Paste. Make it yours.</h2>
          <p id="setup-description" className="mt-4 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-neutral-400">Choose your coding assistant. The prompt guides a private installation, local models, and account setup. Nothing installs from this website.</p>
          <div aria-label="Choose your coding assistant" className="mt-6 grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-black">{SETUP_ASSISTANTS.map(name => <button type="button" key={name} aria-pressed={assistant === name} onClick={() => { setAssistant(name); setCopyState("idle"); }} className={`relative rounded-lg px-2 py-3 text-sm font-medium transition-colors duration-200 ${assistant === name ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white"}`}>
            {assistant === name && <motion.span layoutId="setup-assistant-selection" className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-neutral-700" transition={{ duration: reduced ? 0 : 0.4, ease: [0.32, 0.72, 0, 1] }} />}<span className="relative">{name}</span>
          </button>)}</div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-100 p-4 dark:bg-neutral-800"><input type="checkbox" checked={includeModels} onChange={event => { setIncludeModels(event.target.checked); setCopyState("idle"); }} className="mt-1 h-4 w-4 shrink-0 accent-accent" /><span><span className="block text-sm font-medium">Include local models</span><span className="mt-2 block text-xs leading-relaxed text-slate-500 dark:text-neutral-400">Translation, image text search, and autocorrect. Several GB to download on the workspace computer. Your assistant checks the machine and asks before downloading.</span></span></label>
          <ol className="my-6 space-y-3 text-sm text-slate-500 dark:text-neutral-400"><li><span className="mr-3 text-accent">01</span>Copy the prompt below.</li><li><span className="mr-3 text-accent">02</span>Paste into {assistant} on your computer.</li><li><span className="mr-3 text-accent">03</span>Review setup, then sign in to your accounts.</li></ol>
          <button type="button" onClick={copy} disabled={copyState === "copying"} className="marketing-primary w-full disabled:opacity-50">{copyState === "copied" ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}{copyState === "copied" ? `Copied for ${assistant}` : copyState === "copying" ? "Copying prompt…" : `Copy prompt for ${assistant}`}</button>
          <p role="status" className={`mt-3 text-xs leading-relaxed ${copyState === "error" ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-neutral-400"}`}>{copyState === "error" ? "Clipboard access is blocked. Select and copy the prompt below." : copyState === "copied" ? `Ready to paste into ${assistant}. This does not open the app or run setup automatically.` : "Copies text only. No account credentials are collected here."}</p>
          <details className="mt-6" open={readPrompt} onToggle={event => setReadPrompt(event.currentTarget.open)}><summary className="cursor-pointer rounded text-sm font-medium">Read or manually copy the prompt</summary><textarea aria-label="Setup prompt" readOnly value={prompt} onFocus={event => event.currentTarget.select()} className="mt-4 h-64 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed dark:border-neutral-700 dark:bg-black" /></details>
          <p className="mt-6 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">The repository is private. You need <a href="https://github.com/AZK65/2-Many-DMs" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">repository access ↗</a> before setup. The prompt cannot grant access. Cloud chat AI is separate and optional.</p>
        </div>
      </motion.section>
    </motion.div>
  </OverlayPortal>;
}
