import Link from "next/link";
import { ChangelogList } from "@/components/ChangelogList";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { websiteMetadata } from "@/lib/website-metadata";

export const metadata = websiteMetadata("Updates — 2 Many DMs", "Release notes for the messaging workspace. See what changed and what is new.", "/changelog");

export default function ChangelogPage() {
  return <MarketingShell><main id="main-content" className="mx-auto max-w-5xl px-4 pb-8 pt-20 sm:px-8 sm:pt-24">
    <Link href="/landing" className="marketing-text-link">← Back to the workspace</Link>
    <p className="mt-12 text-sm font-medium text-accent">The changelog</p>
    <h1 className="marketing-heading mt-6 text-5xl font-semibold tracking-tighter sm:text-7xl">A little better.<br />Every update.</h1>
    <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-500 dark:text-neutral-400">What shipped, what changed, and what you can do next. The latest release comes first.</p>
    <div className="mt-16"><ChangelogList /></div>
  </main></MarketingShell>;
}
