import Link from "next/link";
import { MarketingShell } from "../../src/components/marketing/MarketingShell";
export default function NotFound() {
  return <MarketingShell><main id="main-content" className="mx-auto max-w-5xl px-8 py-24">
    <p className="text-sm text-accent">404</p>
    <h1 className="mt-4 text-5xl font-semibold tracking-tight">This page isn’t here.</h1>
    <p className="mt-6 text-slate-500 dark:text-neutral-400">Your personal workspace runs in your own installation, not on this website.</p>
    <Link href="/" className="marketing-primary mt-8 inline-block">Back to 2Many</Link>
  </main></MarketingShell>;
}
