"use client";

import { motion, useReducedMotion } from "motion/react";

const easing = [0.32, 0.72, 0, 1] as const;

export function ThemeSwitch({ theme, onChange, label }: { theme: string; onChange: (theme: string) => void; label: string }) {
  const dark = theme === "dark";
  const reduced = useReducedMotion();

  return <button type="button" aria-label={label} aria-pressed={dark} title={`Switch to ${dark ? "light" : "dark"} mode`} onClick={() => onChange(dark ? "light" : "dark")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-transparent text-slate-500 ring-1 ring-inset ring-slate-200 transition-[color,background-color,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-10 sm:w-10 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-white">
    <motion.svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" initial={false} animate={{ rotate: dark ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.5, ease: easing }}>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </motion.svg>
  </button>;
}
