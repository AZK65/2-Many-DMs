"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CloseIcon, CopyIcon, GlobeIcon } from "./icons";
import type { PhotoTranslationResult } from "@/lib/photo-translation";

export function PhotoTranslationAction({ onClick }: { onClick: () => void }) {
  return <button type="button" data-close-menu onClick={onClick} title="Translate photo to English · on this device"
    aria-label="Translate photo to English locally"
    className="rounded-full p-2 text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-700">
    <GlobeIcon className="h-4 w-4" />
  </button>;
}

export function PhotoTranslation({ conversationId, messageId, onClose }: { conversationId: string; messageId: string; onClose: () => void }) {
  const [result, setResult] = useState<PhotoTranslationResult | null>(null);
  const [stage, setStage] = useState<"reading" | "translating" | "done" | "error">("reading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => { panel.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const request = async (action: "recognize" | "translate") => {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/photo-translation`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-omni-photo-translation": "1" }, body: JSON.stringify({ action }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(200_000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Local photo translation failed. Try again.");
      return data as PhotoTranslationResult;
    };
    void (async () => {
      setError(""); setCopied(false);
      // A translation retry reuses recognized text, not another expensive OCR.
      let original = result;
      if (!original?.originalText) {
        setStage("reading");
        original = await request("recognize");
        if (!active) return;
        setResult(original);
      }
      if (!active) return;
      if (original.empty || !original.originalText) { setStage("done"); return; }
      setStage("translating");
      const translated = await request("translate");
      if (active) { setResult(translated); setStage("done"); }
    })().catch(failure => {
      if (!active) return;
      setError(failure.name === "TimeoutError" ? "Local processing took too long. Try a smaller crop or check Ollama." : failure.message);
      setStage("error");
    });
    return () => { active = false; controller.abort(); };
    // Result is intentionally retained only for an explicit retry, not a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messageId, attempt]);

  return <motion.section ref={panel} tabIndex={-1} aria-label="Local photo translation" aria-busy={stage === "reading" || stage === "translating"}
    initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.2 }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    className="mt-2 w-full min-w-0 rounded-xl bg-slate-100 p-3 text-left text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-[#272727] dark:text-neutral-100">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold">Photo translation</h3><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">English · OCR and translation on this device</p></div>
      <button type="button" onClick={onClose} aria-label="Close photo translation" title="Close photo translation"
        className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-black/5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-white/10"><CloseIcon className="h-4 w-4" /></button>
    </div>
    {(stage === "reading" || stage === "translating") && <div className="mt-3" role="status">
      <p className="text-xs text-slate-600 dark:text-neutral-300">{stage === "reading" ? "Reading text from the photo locally…" : "Translating the recognized text locally…"}</p>
      <div aria-hidden="true" className={`mt-2 space-y-2 ${reduced ? "" : "animate-pulse"}`}><div className="h-2 w-3/4 rounded bg-black/10 dark:bg-white/10" /><div className="h-2 w-1/2 rounded bg-black/10 dark:bg-white/10" /></div>
    </div>}
    {error && <div className="mt-3"><p role="alert" className="break-words text-xs leading-5 text-red-600 dark:text-red-300">{error}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="workspace-button mt-2 px-3 py-2 text-xs">Try again</button></div>}
    {stage === "done" && result?.empty && <p role="status" className="mt-3 text-sm">No readable text found. Try a clearer photo or a crop of the text.</p>}
    {result?.translatedText && <>
      <p role="status" className="mt-3 text-xs text-slate-500 dark:text-neutral-400">{result.detectedLanguageName === "English" ? "The text is already in English." : `${result.detectedLanguageName || "Detected language"} → English`}</p>
      <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]" dir="auto">{result.translatedText}</div>
      <button type="button" className="workspace-button mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs" onClick={async () => {
        try { await navigator.clipboard.writeText(result.translatedText!); setCopied(true); setCopyError(""); }
        catch { setCopyError("Clipboard unavailable. Select and copy the translation above."); }
      }}><CopyIcon className="h-4 w-4" />{copied ? "Copied" : "Copy translation"}</button>
      {copyError && <p role="alert" className="mt-2 text-xs">{copyError}</p>}
    </>}
    {result?.originalText && <details className="mt-3 text-xs text-slate-600 dark:text-neutral-300">
      <summary className="cursor-pointer rounded py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Original text from photo</summary>
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]" dir="auto">{result.originalText}</div>
    </details>}
    <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-neutral-400">Your original photo is unchanged. OCR can misread text; check important details against the image.</p>
  </motion.section>;
}
