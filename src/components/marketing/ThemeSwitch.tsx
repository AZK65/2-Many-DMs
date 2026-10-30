"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, MoonIcon, SunIcon } from "../icons";

const choices = [{ value: "light", label: "Light", Icon: SunIcon }, { value: "dark", label: "Dark", Icon: MoonIcon }];
const easing = [0.32, 0.72, 0, 1] as const;

export function ThemeSwitch({ theme, onChange, label, placement = "bottom", open: controlledOpen, onOpenChange }: { theme: string; onChange: (theme: string) => void; label: string; placement?: "top" | "bottom"; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const dark = theme === "dark";
  const reduced = useReducedMotion();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  function setOpen(value: boolean) { setLocalOpen(value); onOpenChange?.(value); }
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const openingIndex = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      if (root.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
      return;
    }
    items.current[openingIndex.current ?? (dark ? 1 : 0)]?.focus({ preventScroll: true });
    openingIndex.current = null;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, dark]);

  function closeAndFocus() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }

  return <div ref={root} className="relative shrink-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); closeAndFocus(); }
  }}>
    <button ref={trigger} id={`${id}-trigger`} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} aria-label={label} title={`Appearance: ${dark ? "Dark" : "Light"}`} onClick={() => setOpen(!open)} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); openingIndex.current = event.key === "ArrowDown" ? 0 : choices.length - 1; setOpen(true);
      }
    }} className={`group flex h-12 w-12 items-center justify-center gap-2 rounded-full text-sm font-medium ring-1 ring-inset transition-colors duration-200 sm:h-10 sm:w-auto sm:px-3 ${open ? "bg-slate-100 text-slate-900 ring-slate-300 dark:bg-neutral-800 dark:text-white dark:ring-neutral-600" : "bg-transparent text-slate-500 ring-slate-200 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-white"}`}>
      <motion.svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0" initial={false} animate={{ rotate: dark ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.5, ease: easing }}>
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </motion.svg>
      <span className="relative hidden h-5 w-8 overflow-hidden sm:block" aria-hidden>
        <AnimatePresence initial={false}><motion.span key={theme} className="absolute inset-0" initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -8 }} transition={{ duration: reduced ? 0 : 0.2, ease: easing }}>{dark ? "Dark" : "Light"}</motion.span></AnimatePresence>
      </span>
      <motion.svg aria-hidden viewBox="0 0 16 16" className="hidden h-3 w-3 sm:block" fill="none" stroke="currentColor" strokeWidth="1.5" initial={false} animate={{ rotate: open ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.2, ease: easing }}><path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></motion.svg>
    </button>
    <AnimatePresence>{open && <motion.div id={`${id}-menu`} role="menu" aria-labelledby={`${id}-trigger`} className={`absolute right-0 z-50 w-40 rounded-2xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 ${placement === "top" ? "bottom-full mb-2 origin-bottom-right" : "top-full mt-2 origin-top-right"}`} initial={{ opacity: 0, y: reduced ? 0 : placement === "top" ? 4 : -4, scale: reduced ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.96 }} transition={{ duration: reduced ? 0 : 0.2, ease: easing }} onKeyDown={event => {
      const current = items.current.indexOf(document.activeElement as HTMLButtonElement);
      const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (!offset && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      items.current[event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + offset + choices.length) % choices.length]?.focus();
    }}>
      {choices.map(({ value, label: optionLabel, Icon }, index) => <button key={value} ref={element => { items.current[index] = element; }} type="button" role="menuitemradio" aria-checked={theme === value} tabIndex={-1} onClick={() => { onChange(value); closeAndFocus(); }} className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800 ${theme === value ? "font-medium text-slate-900 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>
        <Icon aria-hidden className="h-4 w-4" /><span className="flex-1">{optionLabel}</span>{theme === value && <CheckIcon aria-hidden className="h-4 w-4 text-accent" />}
      </button>)}
    </motion.div>}</AnimatePresence>
  </div>;
}
