"use client";

import { useEffect, useRef, useState } from "react";
import { shouldPlayGif } from "@/lib/gif-media";

export function InlineVideoPlayer({ source, name, isGif = false, onError, onOpen }: {
  source: string; name: string; isGif?: boolean; onError: () => void; onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [intent, setIntent] = useState<"play" | "pause" | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // Cached attachments can finish loading before effects run. Don't erase
    // the already-fired canplay event and leave a ready GIF stuck on Loading.
    const video = videoRef.current;
    setReady((video?.readyState ?? 0) >= 2);
    setDuration(video && Number.isFinite(video.duration) ? video.duration : null);
    setIntent(null);
    setPlaying(false);
  }, [source]);

  useEffect(() => {
    if (!isGif) return;
    const video = videoRef.current;
    if (!video) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updatePreference();
    updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.15), { threshold: [0, 0.15] });
    observer.observe(video);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
      video.pause();
    };
  }, [isGif, source]);

  const autoplay = shouldPlayGif({ isGif, visible, pageVisible, reducedMotion, intent });
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    if (autoplay && ready) {
      void video.play().catch(() => {
        // Autoplay policies are not corrupt media. Offer Play, not Recover.
        if (!cancelled) setPlaying(false);
      });
    } else video.pause();
    return () => { cancelled = true; video.pause(); };
  }, [autoplay, ready, source]);

  return (
    <div className="group/video relative mb-1 aspect-video w-64 max-w-full overflow-hidden rounded-xl bg-[#181818] ring-1 ring-black/10 dark:ring-white/10">
      <button type="button" onClick={onOpen} aria-label={`Open ${name}`}
        className="block h-full w-full text-left transition-opacity hover:opacity-95 active:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <video ref={videoRef} src={source} muted playsInline loop={isGif} preload={isGif ? "auto" : "metadata"}
          onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)}
          onLoadedData={() => setReady(true)} onCanPlay={() => setReady(true)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={onError}
          className="pointer-events-none h-full w-full object-contain" aria-hidden="true" />
        {!ready && <span className="pointer-events-none absolute inset-0 grid place-items-center bg-[#181818] text-xs text-neutral-400">Loading {isGif ? "GIF" : "video"}…</span>}
        {!isGif && <span className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-white text-base text-black shadow-lg transition-transform group-hover/video:scale-105">▶</span></span>}
      </button>
      {isGif ? (
        <button type="button" aria-label={playing ? "Pause GIF" : "Play GIF"} title={playing ? "Pause GIF" : "Play GIF"}
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (playing) { setIntent("pause"); video.pause(); }
            else { setIntent("play"); void video.play().catch(() => setPlaying(false)); }
          }}
          className="absolute bottom-2 right-2 flex min-h-8 items-center gap-2 rounded-lg bg-black/80 px-2.5 text-xs font-medium text-white transition-colors hover:bg-black active:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> GIF
        </button>
      ) : (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-black/80 px-2 py-1 text-xs font-medium tabular-nums text-white">
          {duration === null ? "Open video" : `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, "0")}`}
        </span>
      )}
    </div>
  );
}
