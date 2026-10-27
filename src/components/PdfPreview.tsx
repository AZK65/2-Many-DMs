"use client";
import { OverlayPortal } from "./OverlayPortal";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { motion } from "motion/react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import {
  CloseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshIcon,
} from "./icons";

// This is copied from pdfjs-dist during npm install. Keeping the ESM worker in
// /public prevents Next 14's older minifier from parsing it as a classic script.
const PDF_WORKER_SRC = "/pdf.worker.min.mjs";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.2;

function downloadSource(source: string): string {
  if (source.startsWith("blob:") || source.startsWith("data:")) return source;
  return `${source}${source.includes("?") ? "&" : "?"}download=1`;
}

function friendlyPdfError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/password/i.test(detail)) return "This PDF is password protected.";
  if (/missing|404|not found/i.test(detail)) return "The PDF file is no longer available.";
  return "This PDF could not be displayed here.";
}

export function PdfPreview({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [stageWidth, setStageWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageWidth(stage.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setDocument(null);
    setPageCount(0);
    setPageNumber(1);

    void (async () => {
      try {
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) throw new Error(`PDF request failed (${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error("PDF file is empty");

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
        task = pdfjs.getDocument({ data: bytes });
        const nextDocument = await task.promise;
        if (!active) {
          await nextDocument.destroy();
          return;
        }
        setDocument(nextDocument);
        setPageCount(nextDocument.numPages);
      } catch (loadError) {
        if (active) setError(friendlyPdfError(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      void task?.destroy();
    };
  }, [retry, url]);

  useEffect(() => {
    if (!document || !stageWidth || !canvasRef.current) return;
    let active = true;
    let renderTask: RenderTask | null = null;
    setRendering(true);

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (!active || !canvasRef.current) return;
        const natural = page.getViewport({ scale: 1 });
        const fitWidth = Math.max(240, stageWidth - 32);
        const fitScale = Math.min(2, fitWidth / natural.width);
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable");

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (renderError) {
        if (
          active &&
          !(renderError instanceof Error && renderError.name === "RenderingCancelledException")
        ) {
          setError(friendlyPdfError(renderError));
        }
      } finally {
        if (active) setRendering(false);
      }
    })();

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, pageNumber, stageWidth, zoom]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  const controlClass =
    "grid h-9 min-w-9 place-items-center rounded-lg bg-white/10 px-2 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/20 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <OverlayPortal onClose={onClose}><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-2 backdrop-blur-md sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`PDF preview: ${name}`}
      onMouseDown={closeFromBackdrop}
    >
      <motion.section
        initial={{ y: 12, opacity: 0, scale: 0.99 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 12, opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#181818] shadow-2xl"
      >
        <header className="flex min-h-12 items-center gap-3 border-b border-white/10 px-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-xs font-semibold text-neutral-200">
            PDF
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
            {name}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={controlClass}
            aria-label="Open PDF in a new tab"
            title="Open in new tab"
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
          <a
            href={downloadSource(url)}
            download={name}
            className={`${controlClass} gap-2 sm:flex sm:px-3`}
            aria-label={`Download ${name}`}
          >
            <DownloadIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Download</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className={controlClass}
            aria-label="Close PDF viewer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <nav
          className="flex min-h-12 items-center justify-between gap-3 border-b border-white/10 bg-[#1F1F1F] px-4"
          aria-label="PDF controls"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
              disabled={pageNumber <= 1 || loading}
              className={controlClass}
              aria-label="Previous page"
            >
              ←
            </button>
            <span className="min-w-20 text-center text-xs font-medium tabular-nums text-neutral-300">
              {pageCount ? `${pageNumber} of ${pageCount}` : "Loading"}
            </span>
            <button
              type="button"
              onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))}
              disabled={!pageCount || pageNumber >= pageCount || loading}
              className={controlClass}
              aria-label="Next page"
            >
              →
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM || loading}
              className={controlClass}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="min-w-12 text-center text-xs font-medium tabular-nums text-neutral-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM || loading}
              className={controlClass}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </nav>

        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-auto bg-[#272727]">
          {(loading || rendering) && !error && (
            <div
              className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg bg-[#181818] px-3 py-2 text-xs font-medium text-neutral-300 shadow-lg"
              role="status"
            >
              {loading ? "Opening PDF…" : "Rendering page…"}
            </div>
          )}

          {loading && !error && (
            <div className="mx-auto mt-8 h-3/4 w-2/3 max-w-3xl animate-pulse rounded-lg bg-[#313131]" />
          )}

          {error ? (
            <div className="grid h-full min-h-80 place-items-center p-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-white/10 text-sm font-semibold text-neutral-200">
                  PDF
                </div>
                <h2 className="text-base font-semibold text-white">Preview unavailable</h2>
                <p className="mt-2 text-sm text-neutral-400">{error}</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRetry((value) => value + 1)}
                    className={`${controlClass} flex gap-2 px-3`}
                  >
                    <RefreshIcon className="h-4 w-4" />
                    Try again
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={`${controlClass} flex gap-2 px-3`}
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                    Open file
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto min-h-full min-w-full w-fit p-4">
              <canvas
                ref={canvasRef}
                className={`mx-auto block bg-white shadow-2xl transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  loading ? "opacity-0" : "opacity-100"
                }`}
                aria-label={`Page ${pageNumber} of ${pageCount || 1}`}
              />
            </div>
          )}
        </div>
      </motion.section>
    </motion.div></OverlayPortal>
  );
}
