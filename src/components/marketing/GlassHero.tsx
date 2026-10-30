"use client";

import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

/** Measure the stationary section, never the surface it is animating. */
export function GlassHero({ children }: { children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const glass = useTransform(scrollYProgress, [0, 0.5], [0, 1]);
  const scale = useTransform(glass, [0, 1], [1, 0.98]);
  const y = useTransform(glass, [0, 1], [0, 24]);
  const radius = useTransform(glass, [0, 1], [0, 24]);

  return <section ref={section} data-glass-hero className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-8 sm:pt-16">
    <motion.div data-hero-surface className="relative isolate origin-bottom" style={{ scale: reduced ? 1 : scale, y: reduced ? 0 : y, borderRadius: reduced ? 24 : radius }}>
      {/* Glass lives behind the content: links stay sharp, focusable and clickable. */}
      <motion.div aria-hidden="true" data-hero-glass className="marketing-hero-glass pointer-events-none absolute inset-0 -z-10" style={{ opacity: reduced ? 0 : glass }} />
      <div className="px-4 py-4 sm:p-8">{children}</div>
    </motion.div>
  </section>;
}
