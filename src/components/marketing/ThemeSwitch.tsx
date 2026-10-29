"use client";

import { motion, useReducedMotion } from "motion/react";
import { MoonIcon, SunIcon } from "../icons";

export function ThemeSwitch({ theme, onChange, label }: { theme: string; onChange: (theme: string) => void; label: string }) {
  const dark = theme === "dark";
  const reduced = useReducedMotion();
  return <button type="button" role="switch" aria-checked={dark} aria-label={label} title={`Switch to ${dark ? "light" : "dark"} mode`} onClick={() => onChange(dark ? "light" : "dark")}
    className="relative grid h-12 w-20 shrink-0 grid-cols-2 items-center gap-2 rounded-full bg-slate-100 p-1 text-slate-400 ring-1 ring-inset ring-slate-200 transition-colors duration-500 hover:ring-slate-300 dark:bg-black dark:text-neutral-500 dark:ring-neutral-700 dark:hover:ring-neutral-500">
    <motion.span aria-hidden data-theme-thumb className="absolute left-1 top-2 h-8 w-8 rounded-full bg-white shadow-sm dark:bg-neutral-700" initial={false} animate={{ x: dark ? 40 : 0 }} transition={{ duration: reduced ? 0 : 0.5, ease: [0.32, 0.72, 0, 1] }} />
    <motion.span aria-hidden className={`relative grid place-items-center ${!dark ? "text-slate-900" : ""}`} initial={false} animate={{ rotate: dark ? -45 : 0, scale: dark ? 0.85 : 1 }} transition={{ duration: reduced ? 0 : 0.5, ease: [0.32, 0.72, 0, 1] }}><SunIcon className="h-4 w-4" /></motion.span>
    <motion.span aria-hidden className={`relative grid place-items-center ${dark ? "text-white" : ""}`} initial={false} animate={{ rotate: dark ? 0 : 30, scale: dark ? 1 : 0.85 }} transition={{ duration: reduced ? 0 : 0.5, ease: [0.32, 0.72, 0, 1] }}><MoonIcon className="h-4 w-4" /></motion.span>
  </button>;
}
