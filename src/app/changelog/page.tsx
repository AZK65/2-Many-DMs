import Link from "next/link";
import { ChangelogList } from "@/components/ChangelogList";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = {
  title: "Changelog — 2 Many DMs",
  description: "Every release of 2 Many DMs, newest first.",
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-black dark:text-neutral-100">
      <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl dark:border-neutral-800/60 dark:bg-black/50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/landing" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/lockup-light.png"
              alt="2 Many DMs"
              className="h-7 w-auto dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/lockup-dark.png"
              alt="2 Many DMs"
              className="hidden h-7 w-auto dark:block"
            />
          </Link>
          <div className="flex items-center gap-1.5">
            <Link
              href="/landing"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              ← Home
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-16">
        <div className="font-mono text-xs font-medium uppercase tracking-widest text-accent">
          Changelog
        </div>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          What&apos;s new
        </h1>
        <p className="mt-3 text-slate-500 dark:text-neutral-400">
          Every release of 2 Many DMs, newest first.
        </p>
        <div className="mt-12">
          <ChangelogList />
        </div>
      </main>
    </div>
  );
}
