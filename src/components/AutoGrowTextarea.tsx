"use client";

import { forwardRef, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Measure offscreen so shrinking never flashes a collapsed input or moves the caret. */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; onMultilineChange?: (multiline: boolean) => void }>(
  function AutoGrowTextarea({ value, className = "", style, minRows = 1, onMultilineChange, ...props }, ref) {
    const mirror = useRef<HTMLTextAreaElement>(null);
    const container = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ height: 40, capped: false });
    const reducedMotion = useReducedMotion();
    const multilineCallback = useRef(onMultilineChange);
    multilineCallback.current = onMultilineChange;

    useLayoutEffect(() => {
      const measure = () => {
        const input = mirror.current;
        if (!input || !input.clientWidth) return;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const min = parseFloat(getComputedStyle(input).lineHeight) * Math.max(1, minRows) +
          parseFloat(getComputedStyle(input).paddingTop) + parseFloat(getComputedStyle(input).paddingBottom);
        const limit = Math.max(min, Math.floor(viewportHeight * 0.4));
        const height = Math.max(min, Math.min(input.scrollHeight, limit));
        const capped = input.scrollHeight > limit;
        multilineCallback.current?.(height > min + 1);
        setSize(previous => previous.height === height && previous.capped === capped ? previous : { height, capped });
      };
      measure();
      let width = container.current?.clientWidth;
      const observer = new ResizeObserver(() => {
        const nextWidth = container.current?.clientWidth;
        if (nextWidth !== width) { width = nextWidth; measure(); }
      });
      if (container.current) observer.observe(container.current);
      window.addEventListener("resize", measure);
      window.visualViewport?.addEventListener("resize", measure);
      let mounted = true;
      void document.fonts.ready.then(() => { if (mounted) measure(); });
      return () => {
        mounted = false;
        observer.disconnect();
        window.removeEventListener("resize", measure);
        window.visualViewport?.removeEventListener("resize", measure);
      };
    }, [value, minRows]);

    return <motion.div ref={container} className="relative min-w-0 flex-1 self-end"
      initial={false} animate={{ height: size.height }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}>
      <textarea {...props} ref={ref} value={value} className={`block h-full w-full ${className}`}
        style={{ ...style, overflowY: size.capped ? "auto" : "hidden" }} />
      <textarea ref={mirror} aria-hidden="true" tabIndex={-1} readOnly value={value ?? ""} rows={1}
        className={`pointer-events-none invisible absolute left-0 top-0 w-full ${className}`}
        style={{ ...style, height: 0, minHeight: 0, maxHeight: "none", overflow: "hidden" }} />
    </motion.div>;
  }
);
