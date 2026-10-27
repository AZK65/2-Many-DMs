"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsPresent } from "motion/react";

const layers: HTMLElement[] = [];
let originalOverflow = "";
const focusable = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]';

/** Dialogs belong to the viewport, never to a clipped or animated chat pane. */
export function OverlayPortal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const [mounted, setMounted] = useState(false);
  const present = useIsPresent();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    const layer = root.current;
    if (!mounted || !layer) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!layers.length) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    layers.push(layer);
    const candidates = () => Array.from(layer.querySelectorAll<HTMLElement>(focusable)).filter(el => el.getClientRects().length && !el.closest('[aria-hidden="true"]'));
    const frame = requestAnimationFrame(() => {
      if (!layer.contains(document.activeElement)) (candidates()[0] || layer).focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (layers.at(-1) !== layer) return;
      if (event.key === "Escape" && close.current) {
        event.preventDefault(); event.stopImmediatePropagation(); close.current();
      }
      if (event.key === "Tab") {
        const items = candidates();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) { event.preventDefault(); layer.focus(); }
        else if (event.shiftKey ? index <= 0 : index === items.length - 1 || index < 0) {
          event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
        }
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown, true);
      layers.splice(layers.indexOf(layer), 1);
      if (!layers.length) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected && (layer.contains(document.activeElement) || document.activeElement === document.body)) previous.focus({ preventScroll: true });
    };
  }, [mounted]);
  return mounted ? createPortal(<div ref={root} tabIndex={-1} className="overlay-portal" data-dialog-layer data-exiting={!present || undefined}>{children}</div>, document.body) : null;
}
