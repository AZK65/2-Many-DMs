"use client";

import { useLayoutEffect, useRef } from "react";
import type { PhotoTextRegion } from "@/lib/photo-layout";

function TextPatch({ region }: { region: PhotoTextRegion }) {
  const root = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = root.current, label = text.current;
    if (!box || !label) return;
    const fit = () => {
      let lo = 1, hi = box.clientHeight * 0.8;
      // Measure actual glyphs so long translations fit on narrow screens too.
      for (let n = 0; n < 12; n++) {
        const size = (lo + hi) / 2;
        label.style.fontSize = `${size}px`;
        if (label.scrollHeight > box.clientHeight || label.scrollWidth > box.clientWidth) hi = size;
        else lo = size;
      }
      label.style.fontSize = `${lo}px`;
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(box);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [region.translatedText]);
  const [left, top, right, bottom] = region.box;
  const pad = 0.003;
  return <div ref={root} className="absolute flex items-center overflow-hidden rounded-sm bg-white text-black"
    style={{ left: `${Math.max(0, left - pad) * 100}%`, top: `${Math.max(0, top - pad) * 100}%`,
      width: `${(Math.min(1, right + pad) - Math.max(0, left - pad)) * 100}%`, height: `${(Math.min(1, bottom + pad) - Math.max(0, top - pad)) * 100}%` }}
    title={region.text}>
    <span ref={text} dir="auto" className="block w-full whitespace-pre-wrap break-words text-left leading-tight [overflow-wrap:anywhere]">{region.translatedText}</span>
  </div>;
}

export function TranslatedPhotoImage({ source, regions, translated, expanded = false, onError }: {
  source: string; regions: PhotoTextRegion[]; translated: boolean; expanded?: boolean; onError: () => void;
}) {
  return <div className="relative inline-block max-w-full align-top" data-photo-view={translated ? "translated" : "original"}>
    {/* Natural image bounds, not an object-fit letterbox, anchor every patch. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={source} alt={translated ? "Photo with English translation over the original text" : "Original photo"} onError={onError}
      className={`block h-auto w-auto max-w-full rounded-lg ${expanded ? "max-h-[70dvh]" : "max-h-80"}`} />
    {translated && <div className="absolute inset-0" aria-label="Translated text on photo">
      {regions.filter(r => r.translatedText).map(r => <TextPatch key={r.id} region={r} />)}
    </div>}
  </div>;
}
