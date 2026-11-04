"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "motion/react";
import { CloseIcon, ExternalLinkIcon, GlobeIcon, RefreshIcon } from "./icons";
import { OverlayPortal } from "./OverlayPortal";

type PreviewState = "loading" | "ready" | "slow" | "error";
type XPostPreview = { postUrl: string; authorName: string; authorUrl?: string; text: string };

function linkDetails(url: string) {
  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname.replace(/^www\./, ""),
      displayUrl: `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
    };
  } catch {
    return { hostname: "External link", displayUrl: url };
  }
}

function previewSource(rawUrl: string): { url: string; kind: "page" | "post" | "video" } {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "x.com" || host === "twitter.com") {
      const statusId = url.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];
      if (statusId) {
        return {
          url: `https://platform.twitter.com/embed/Tweet.html?id=${statusId}&dnt=true`,
          kind: "post",
        };
      }
    }

    if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com") {
      const videoId =
        host === "youtu.be"
          ? url.pathname.split("/").filter(Boolean)[0]
          : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
      if (videoId && /^[\w-]{6,}$/.test(videoId)) {
        return {
          url: `https://www.youtube-nocookie.com/embed/${videoId}`,
          kind: "video",
        };
      }
    }

    if (host === "vimeo.com") {
      const videoId = url.pathname.match(/^\/(\d+)/)?.[1];
      if (videoId) {
        return { url: `https://player.vimeo.com/video/${videoId}`, kind: "video" };
      }
    }
  } catch {
    // The original URL remains the safest fallback for malformed input.
  }

  return { url: rawUrl, kind: "page" };
}

function previewSandbox(sourceUrl: string): string {
  const base = "allow-downloads allow-forms allow-presentation allow-scripts";
  try {
    // Cross-origin pages can keep their normal origin without gaining access to the host app.
    // Same-origin links stay isolated so they cannot remove their own sandbox.
    return new URL(sourceUrl).origin === window.location.origin
      ? base
      : `${base} allow-same-origin`;
  } catch {
    return base;
  }
}

export function LinkPreview({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PreviewState>("loading");
  const [frameKey, setFrameKey] = useState(0);
  const [xPost, setXPost] = useState<XPostPreview | null>(null);
  const details = linkDetails(url);
  const source = previewSource(url);

  useEffect(() => {
    if (source.kind !== "post") return;
    const controller = new AbortController();
    setState("loading");
    setXPost(null);
    void fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Preview unavailable");
        if (!controller.signal.aborted) { setXPost(data); setState("ready"); }
      })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [frameKey, source.kind, url]);

  useEffect(() => {
    if (state !== "loading") return;
    const slowTimer = window.setTimeout(() => setState("slow"), 8_000);
    return () => window.clearTimeout(slowTimer);
  }, [frameKey, state, url]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function reload() {
    setState("loading");
    setFrameKey((current) => current + 1);
  }

  const statusLabel =
    state === "loading"
      ? "Opening here"
      : state === "slow"
        ? "Still loading"
        : state === "error"
          ? "Preview unavailable"
          : "Open in Omni";

  const controlClass =
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-100 dark:shadow-none dark:hover:bg-white/10 dark:focus-visible:ring-offset-[#181818]";

  return (
    <OverlayPortal onClose={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
        className="fixed inset-0 z-50 flex bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4 lg:p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`Link preview: ${label}`}
        onMouseDown={closeFromBackdrop}
      >
        <motion.section
          initial={{ y: 14, opacity: 0, scale: 0.99 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 14, opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
          className="mx-auto flex h-full w-full max-w-[90rem] flex-col overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl dark:bg-[#181818]"
        >
          <header className="flex min-h-16 items-center gap-3 border-b border-slate-200 px-3 sm:px-4 dark:border-white/10">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/15">
              <GlobeIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {details.hostname}
                </h2>
                <span
                  className="hidden shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 sm:inline-flex dark:bg-white/[0.07] dark:text-neutral-300"
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      state === "ready"
                        ? "bg-emerald-500"
                        : state === "error"
                          ? "bg-red-500"
                          : "animate-pulse bg-amber-500"
                    }`}
                  />
                  {statusLabel}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500 dark:text-neutral-400">
                {details.displayUrl}
              </p>
            </div>
            <button
              type="button"
              onClick={reload}
              className={`${controlClass} w-9 px-0`}
              aria-label="Reload link preview"
              title="Reload preview"
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className={controlClass}
              aria-label={`Open ${details.hostname} externally`}
              title="Open externally"
            >
              <ExternalLinkIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Open externally</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className={`${controlClass} w-9 px-0`}
              aria-label="Close link preview"
              autoFocus
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 bg-slate-100 dark:bg-[#101010]">
            {(state === "loading" || state === "slow") && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-white dark:bg-[#181818]">
                <div className="mx-auto max-w-sm px-6 text-center">
                  <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/15">
                    <GlobeIcon className="h-5 w-5 animate-pulse" />
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {state === "slow" ? "This page is taking longer than usual" : "Opening inside 2 Many DMs"}
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                    {state === "slow"
                      ? "The site may block embedded previews. You can reload it or open it externally."
                      : "You can keep the conversation open while the page loads."}
                  </p>
                </div>
              </div>
            )}
            {state === "error" && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-white dark:bg-[#181818]" role="alert">
                <div className="mx-auto max-w-sm px-6 text-center">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">This site could not be shown here</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                    Some websites block embedded viewing. Use Open externally to continue.
                  </p>
                </div>
              </div>
            )}
            {source.kind === "post" ? (
              xPost && state === "ready" ? (
                <div className="grid h-full place-items-center overflow-y-auto p-4 sm:p-8">
                  <article className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-black text-sm font-bold text-white dark:bg-white dark:text-black">X</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{xPost.authorName}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400">Public post on X</p>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-neutral-100">{xPost.text}</p>
                  </article>
                </div>
              ) : null
            ) : (
              <iframe
                key={frameKey}
                src={source.url}
                title={`Preview of ${label}`}
                className="h-full w-full border-0 bg-white"
                sandbox={previewSandbox(source.url)}
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setState("ready")}
                onError={() => setState("error")}
              />
            )}
          </div>

          <footer className="flex min-h-9 items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 text-[11px] text-slate-500 sm:px-4 dark:border-white/10 dark:bg-[#181818] dark:text-neutral-400">
            <span className="truncate">
              {source.kind === "post"
                ? "Embedded post preview"
                : source.kind === "video"
                  ? "Embedded video preview"
                  : "Restricted in-app preview"}
            </span>
            <span className="shrink-0">Blank page? The site may block embeds.</span>
          </footer>
        </motion.section>
      </motion.div>
    </OverlayPortal>
  );
}
