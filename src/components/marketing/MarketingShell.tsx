"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OverlayPortal } from "../OverlayPortal";
import { ThemeSwitch } from "./ThemeSwitch";
import { TerminalLogo } from "./TerminalLogo";
import { GetStartedButton, SetupPromptProvider, useSetupPrompt } from "./SetupPrompt";

const navigation = [["/landing#workspace", "The workspace"], ["/landing#connections", "Connections"], ["/changelog", "Updates"]];
const easing = [0.32, 0.72, 0, 1] as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return <SetupPromptProvider><MarketingLayout>{children}</MarketingLayout></SetupPromptProvider>;
}

function MarketingLayout({ children }: { children: ReactNode }) {
  const openSetup = useSetupPrompt();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [compact, setCompact] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const previous = document.documentElement.classList.contains("dark");
    let saved = "dark";
    try { saved = localStorage.getItem("2many-site-theme") || "dark"; } catch {}
    setTheme(saved === "light" ? "light" : "dark");
    document.documentElement.classList.toggle("dark", saved !== "light");
    return () => { document.documentElement.classList.toggle("dark", previous); };
  }, []);

  useEffect(() => {
    const target = sentinel.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  function changeTheme(value: string) {
    setTheme(value);
    document.documentElement.classList.toggle("dark", value === "dark");
    try { localStorage.setItem("2many-site-theme", value); } catch {}
  }

  function themePicker(label: string, showLabel = false) {
    return <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-neutral-400">
      {showLabel && <span>Appearance</span>}
      <ThemeSwitch theme={theme} onChange={changeTheme} label={`${label}: dark mode`} />
    </div>;
  }

  return <div className="marketing-site relative min-h-dvh bg-white text-slate-900 dark:bg-black dark:text-neutral-100">
    <div ref={sentinel} aria-hidden className="pointer-events-none absolute left-0 top-0 h-32 w-px" />
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:p-4 focus:text-accent-fg">Skip to content</a>
    <header className="sticky top-2 z-40 mx-4 h-20 max-w-7xl pt-2 sm:top-4 sm:mx-8 sm:h-24 sm:pt-4 xl:mx-auto" data-navbar-compact={compact}>
      <motion.nav layout={!reduced} transition={{ layout: { duration: 0.7, ease: easing } }} aria-label="Main navigation" className={`mx-auto flex items-center justify-between gap-2 rounded-full border border-slate-200 bg-white/95 px-3 backdrop-blur-xl sm:gap-4 sm:px-6 dark:border-neutral-800 dark:bg-neutral-900/95 ${compact ? "max-w-4xl py-2 shadow-lg shadow-slate-900/5 dark:shadow-black/40" : "max-w-7xl py-2 sm:py-4"}`}>
        <motion.div layout="position" className="shrink-0">
          <TerminalLogo />
        </motion.div>
        <motion.div layout="position" className="hidden items-center gap-6 lg:flex">
          {navigation.map(([href, label]) => <Link href={href} key={href} aria-current={pathname === href ? "page" : undefined} className={`whitespace-nowrap text-sm font-medium transition-colors duration-200 hover:text-accent ${pathname === href ? "text-accent" : "text-slate-500 dark:text-neutral-400"}`}>{label}</Link>)}
        </motion.div>
        <motion.div layout="position" className="flex shrink-0 items-center gap-2 sm:gap-3">
          {themePicker("Website appearance")}
          <GetStartedButton className="hidden rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-700 sm:block dark:bg-white dark:text-black dark:hover:bg-neutral-200" />
          <button type="button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="website-mobile-menu" onClick={() => setMenuOpen(true)} className="relative h-12 w-12 shrink-0 rounded-full transition-colors duration-200 hover:bg-slate-100 lg:hidden dark:hover:bg-neutral-800"><span className="absolute left-4 top-5 h-px w-4 bg-current" /><span className="absolute left-4 top-7 h-px w-4 bg-current" /></button>
        </motion.div>
      </motion.nav>
    </header>
    <AnimatePresence>{menuOpen && <OverlayPortal onClose={() => setMenuOpen(false)}>
      <motion.div id="website-mobile-menu" role="dialog" aria-modal="true" aria-label="Website navigation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2 }} className="marketing-mobile-menu fixed inset-0 flex flex-col overflow-y-auto bg-white/95 p-8 text-slate-950 backdrop-blur-3xl dark:bg-black/95 dark:text-white">
        <div className="flex items-center justify-between"><span className="text-lg font-semibold">2 Many DMs</span><button type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} className="relative h-10 w-10 rounded-lg"><span className="absolute left-3 top-5 h-px w-4 rotate-45 bg-current transition-transform duration-200" /><span className="absolute left-3 top-5 h-px w-4 -rotate-45 bg-current transition-transform duration-200" /></button></div>
        <nav className="my-auto space-y-8 py-8" aria-label="Mobile navigation">
          {[...navigation, ["/landing#onboarding", "Onboarding"]].map(([href, label], index) => <motion.div key={href} initial={{ opacity: 0, y: reduced ? 0 : 48 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : index * 0.08, ease: easing }}><Link onClick={() => setMenuOpen(false)} href={href} className="flex items-start justify-between gap-4 text-3xl font-medium tracking-tight"><span>{label}</span><span className="shrink-0 text-accent" aria-hidden>↗</span></Link></motion.div>)}
          <button type="button" onClick={() => { setMenuOpen(false); openSetup(); }} className="flex w-full items-start justify-between gap-4 text-left text-3xl font-medium tracking-tight">Get started <span className="text-accent" aria-hidden>↗</span></button>
        </nav>
        {themePicker("Mobile menu appearance", true)}
      </motion.div>
    </OverlayPortal>}</AnimatePresence>
    {children}
    <footer className="mx-auto max-w-7xl px-4 pb-8 pt-16 sm:px-8">
      <div className="flex flex-col justify-between gap-8 border-t border-slate-200 py-8 md:flex-row dark:border-neutral-800">
        <div><Link href="/landing" className="text-xl font-semibold tracking-tight">2 Many DMs<span className="text-accent">.</span></Link><p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">Less switching. More conversation.</p></div>
        <nav aria-label="Footer navigation" className="flex flex-wrap items-start gap-6 text-sm text-slate-500 dark:text-neutral-400"><Link href="/landing#questions">Questions</Link><Link href="/privacy">Data & privacy</Link><Link href="/changelog">Updates</Link><a href="https://github.com/AZK65/2-Many-DMs" target="_blank" rel="noopener noreferrer">GitHub ↗</a></nav>
        {themePicker("Footer appearance", true)}
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-slate-400 dark:text-neutral-500">An independent messaging workspace. Not affiliated with Telegram, WhatsApp, X, or Discord. Connection capabilities and provider limits vary. Public code. Your own installation.</p>
    </footer>
  </div>;
}

export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 64, filter: "blur(8px)" }} whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: reduced ? 0 : 0.8, ease: easing }}>{children}</motion.div>;
}
