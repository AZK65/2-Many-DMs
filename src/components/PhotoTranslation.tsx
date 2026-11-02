"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CloseIcon, CopyIcon, GlobeIcon } from "./icons";
import { OverlayPortal } from "./OverlayPortal";
import { TranslatedPhotoImage } from "./TranslatedPhotoImage";
import type { PhotoTranslationResult } from "@/lib/photo-translation";

export function PhotoTranslationAction({ onClick }: { onClick: () => void }) {
  return <button type="button" data-close-menu onClick={onClick} title="Translate photo to English · on this device"
    aria-label="Translate photo to English locally"
    className="rounded-full p-2 text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-700">
    <GlobeIcon className="h-4 w-4" />
  </button>;
}

export function PhotoTranslation({ conversationId, messageId, source, onClose }: { conversationId: string; messageId: string; source: string | null; onClose: () => void }) {
  const [result, setResult] = useState<PhotoTranslationResult | null>(null);
  const [stage, setStage] = useState<"reading" | "translating" | "done" | "error">("reading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [view, setView] = useState<"translated" | "original">("translated");
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => { panel.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const request = async (action: "recognize" | "translate") => {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/photo-translation`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-omni-photo-translation": "1" }, body: JSON.stringify({ action }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Local photo translation failed. Try again.");
      return data as PhotoTranslationResult;
    };
    void (async () => {
      setError(""); setCopied(false); setCopyError(""); setStage("reading");
      // Re-read on retry: layout may have expired or the file may have changed.
      const original = await request("recognize");
      if (!active) return;
      setResult(original);
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
  }, [conversationId, messageId, attempt]);

  const ready = stage === "done" && !!result?.translatedText && !!result.regions?.length;
  const button = "rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200 hover:bg-black/5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:hover:bg-white/10";
  const image = (large = false) => source && !imageFailed
    ? <TranslatedPhotoImage source={source} regions={result?.regions || []} translated={ready && view === "translated"} expanded={large} onError={() => setImageFailed(true)} />
    : <p className="p-4 text-xs text-slate-500 dark:text-neutral-400">Photo unavailable. Close translation and recover the attachment first.</p>;
  const controls = (large = false) => <div className="flex flex-wrap items-center justify-between gap-2 py-2">
    <div className="inline-flex rounded-lg bg-black/5 p-0.5 dark:bg-white/5" role="group" aria-label="Photo view">
      <button type="button" aria-pressed={view === "original"} onClick={() => setView("original")} className={`${button} ${view === "original" ? "bg-white shadow-sm dark:bg-neutral-700" : ""}`}>Original</button>
      <button type="button" aria-pressed={view === "translated"} disabled={!ready} onClick={() => setView("translated")} className={`${button} ${view === "translated" && ready ? "bg-white shadow-sm dark:bg-neutral-700" : ""}`}>Translated</button>
    </div>
    <div className="flex items-center gap-1">
      {!large && <button type="button" disabled={!source || imageFailed} onClick={() => setExpanded(true)} className={button}>Enlarge</button>}
      {ready && <button type="button" className={button} aria-label={copied ? "Translation copied" : "Copy translation"} title={copied ? "Copied" : "Copy translation"} onClick={async () => {
        try { await navigator.clipboard.writeText(result!.translatedText!); setCopied(true); setCopyError(""); }
        catch { setCopyError("Clipboard unavailable. Select and copy the text below."); }
      }}><CopyIcon className="h-4 w-4" /></button>}
      <button type="button" onClick={large ? () => setExpanded(false) : onClose} className={button} aria-label={large ? "Close enlarged photo" : "Close photo translation"}><CloseIcon className="h-4 w-4" /></button>
    </div>
  </div>;
  const status = <div className="space-y-2 pb-2 text-xs text-slate-500 dark:text-neutral-400">
    <p role="status">{stage === "reading" ? "Finding text areas locally…" : stage === "translating" ? "Translating text areas locally…" : result?.empty ? "No readable text found. Try a clearer photo." : ready ? `${result?.detectedLanguageName || "Detected language"} → English · On this device` : "Photo translation · On this device"}</p>
    {(stage === "reading" || stage === "translating") && <div aria-hidden className={`h-1 w-1/2 rounded-full bg-accent/40 ${reduced ? "" : "animate-pulse"}`} />}
    {error && <><p role="alert" className="break-words text-red-600 dark:text-red-300">{error}</p><button type="button" onClick={() => { setResult(null); setAttempt(v => v + 1); panel.current?.focus(); }} className="workspace-button px-3 py-2 text-xs">Try again</button></>}
    {copyError && <p role="alert">{copyError}</p>}
    {copied && <span role="status" className="sr-only">Translation copied</span>}
    {ready && result?.layoutApproximate && <p>Text positions are estimated. Compare with Original.</p>}
  </div>;
  const transcript = result?.originalText && <details className="pb-2 text-xs text-slate-500 dark:text-neutral-400">
    <summary className="cursor-pointer rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Text &amp; original</summary>
    <div className="max-h-48 space-y-3 overflow-y-auto whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]">
      {result.translatedText && <div dir="auto"><strong className="font-medium">English</strong><p>{result.translatedText}</p></div>}
      <div dir="auto"><strong className="font-medium">Original</strong><p>{result.originalText}</p></div>
      <p>Your photo is unchanged. OCR can misread text; check important details.</p>
    </div>
  </details>;
  return <motion.section ref={panel} tabIndex={-1} aria-label="Local photo translation" aria-busy={stage === "reading" || stage === "translating"}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.2 }}
    onKeyDown={event => { if (event.key === "Escape" && !expanded) { event.stopPropagation(); onClose(); } }}
    className="max-w-full rounded-lg text-left text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-100">
    {image()}{controls()}{status}{transcript}
    {expanded && <OverlayPortal onClose={() => setExpanded(false)}><div role="dialog" aria-modal="true" aria-label="Photo translation preview"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/95 p-4 backdrop-blur-xl dark:bg-[#181818]/95 sm:p-8"
      onMouseDown={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-auto rounded-xl bg-slate-50 p-3 dark:bg-[#1F1F1F]">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Photo translation</h2>{controls(true)}</div>
        <div className="min-h-0 overflow-auto text-center">{image(true)}</div>
        <div className="mt-3">{status}{transcript}</div>
      </div>
    </div></OverlayPortal>}
  </motion.section>;
}
