"use client";

import { useState, useEffect } from "react";
import { PLATFORMS, PLATFORM_ORDER, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import ThemeToggle from "./ThemeToggle";
import { ChangelogList } from "./ChangelogList";
import { TG_LINK } from "@/lib/links";

const GITHUB_URL = "https://github.com/AZK65/2-Many-DMs";

const DEPLOY_PROMPT =
  `Clone and deploy this unified-inbox CRM for me: \`git clone ${GITHUB_URL}.git && cd 2-Many-DMs\`, then \`npm install\`. Copy \`.env.example\` to \`.env\` and fill in DATABASE_URL, TELEGRAM_API_ID, TELEGRAM_API_HASH and APP_ENCRYPTION_KEY (\`openssl rand -hex 32\`). Apply the Prisma schema with \`npx prisma db push\`, then build and deploy using the included Dockerfile — Railway works great and the repo ships a railway.json. Run the sync worker (\`npm run sync\`) alongside the web server.`;

export function Landing() {
  const [copied, setCopied] = useState<string | null>(null);

  type ChangeEntry = {
    version: string;
    date?: string;
    title?: string;
    notes?: string[];
  };
  const [changelog, setChangelog] = useState<ChangeEntry[]>([]);
  useEffect(() => {
    fetch("/changelog.json")
      .then((r) => r.json())
      .then((d) => setChangelog(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => {});
  }, []);

  function copy(which: string) {
    navigator.clipboard?.writeText(DEPLOY_PROMPT).catch(() => {});
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-slate-900 dark:bg-black dark:text-neutral-100">
      {/* Background atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[820px]">
        <div className="lp-grid lp-grid-mask absolute inset-0" />
        <div className="absolute left-1/2 top-[-160px] h-[440px] w-[860px] -translate-x-1/2 rounded-full bg-accent/20 blur-[130px] dark:bg-accent/25" />
        <div className="absolute left-1/2 top-[-40px] h-[360px] w-[560px] -translate-x-1/2 rounded-full bg-accent/12 blur-[130px] dark:bg-accent/16" />
      </div>

      {/* Copied-to-clipboard toast */}
      {copied && (
        <div className="animate-copy-pop fixed left-1/2 top-5 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-xl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent">
            <path d="M20 6 9 17l-5-5" className="animate-check-draw" />
          </svg>
          Prompt copied — paste it into your agent
        </div>
      )}

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl dark:border-neutral-800/60 dark:bg-black/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/lockup-light.png" alt="2 Many DMs" className="h-7 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/lockup-dark.png" alt="2 Many DMs" className="hidden h-7 w-auto dark:block" />
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 sm:flex dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M12 2A10 10 0 0 0 8.84 21.5c.5.08.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.57.67.48A10 10 0 0 0 12 2Z" />
              </svg>
              GitHub
            </a>
            <a
              href={TG_LINK}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 sm:block dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Support
            </a>
            <a
              href="/changelog"
              className="hidden rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 sm:block dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Changelog
            </a>
            <a
              href="#deploy"
              className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent"
            >
              Deploy
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-5 pb-12 pt-20 text-center sm:pt-28">
        {changelog[0] && (
          <div className="flex justify-center">
            <a
              href="/changelog"
              className="animate-fade-in mb-3 inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition hover:bg-accent/20"
            >
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-fg">
                NEW
              </span>
              v{changelog[0].version}
              {changelog[0].title ? ` — ${changelog[0].title}` : ""} →
            </a>
          </div>
        )}
        <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-300">
          <span className="flex -space-x-1.5">
            {PLATFORM_ORDER.map((p) => (
              <span
                key={p}
                className="grid h-4 w-4 place-items-center rounded-full text-white ring-2 ring-white dark:ring-black"
                style={{ backgroundColor: PLATFORMS[p].bg }}
              >
                <PlatformGlyph platform={p} className="h-2.5 w-2.5" />
              </span>
            ))}
          </span>
          Telegram · WhatsApp · X — one inbox
        </div>

        <h1 className="animate-fade-in-1 mx-auto max-w-3xl text-[2.6rem] font-bold leading-[1.05] tracking-tight sm:text-[4.2rem]">
          One inbox for every DM.
          <br />
          <span className="text-accent dark:text-accent">
            A CRM that lives in your chats.
          </span>
        </h1>

        <p className="animate-fade-in-1 mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-500 dark:text-neutral-400 sm:text-lg">
          Sync Telegram, WhatsApp and X DMs into a single workspace. Triage by
          who owes a reply, run a pipeline, and automate follow-ups — self-hosted,
          your keys, your data.
        </p>

        <div className="animate-fade-in-2 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={() => copy("claude")}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition hover:bg-accent sm:w-auto"
          >
            <CopyIcon active={copied === "claude"} glyph="✳" />
            {copied === "claude" ? "Copied!" : "Deploy with Claude Code"}
          </button>
          <button
            onClick={() => copy("codex")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-900 backdrop-blur transition hover:bg-white sm:w-auto dark:border-neutral-700 dark:bg-neutral-900/70 dark:text-white dark:hover:bg-neutral-800"
          >
            <CopyIcon active={copied === "codex"} glyph="◇" />
            {copied === "codex" ? "Copied!" : "Deploy with Codex"}
          </button>
        </div>
        <p className="animate-fade-in-2 mt-3 text-xs text-slate-400 dark:text-neutral-500">
          Copies a ready-to-paste prompt — drop it into your agent and it ships.{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            View source on GitHub ↗
          </a>
        </p>

        {/* Trust strip */}
        <div className="animate-fade-in-2 mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-600">
          {["Open source", "Self-hosted", "Your keys · your data", "No SaaS lock-in"].map(
            (t, i) => (
              <span key={t} className="flex items-center gap-5">
                {i > 0 && <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-neutral-700" />}
                {t}
              </span>
            ),
          )}
        </div>

        {/* Product centerpiece */}
        <div className="animate-fade-in-3 relative mx-auto mt-16 max-w-4xl">
          <div className="absolute -inset-x-8 -top-8 bottom-0 -z-10 rounded-[2rem] bg-gradient-to-b from-accent/18 to-transparent blur-2xl" />
          <BrowserFrame>
            <AppMock />
          </BrowserFrame>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionLabel n="01" label="Workspace" />
        <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Everything you need to run DMs like a CRM
        </h2>
        <p className="mt-3 max-w-xl text-base text-slate-500 dark:text-neutral-400">
          Not just a unified inbox — a full workspace for turning conversations
          into customers.
        </p>

        <div className="mt-10 grid auto-rows-[176px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Bento
            className="sm:col-span-2 lg:row-span-2"
            icon="triage"
            title="Turn-based triage inbox"
            desc="Every chat is sorted by whose turn it is — Needs reply vs Cold — so you never drop a lead. Snooze, mark done, and a “going cold” badge for anyone you've left waiting."
          >
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              {["Needs reply 30", "Cold 40", "Snoozed", "Done"].map((t, i) => (
                <span
                  key={t}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                    i === 0
                      ? "bg-accent text-accent-fg"
                      : i === 1
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
          </Bento>

          <Bento icon="pipeline" title="Pipeline board" desc="Drag contacts through Lead → Contacted → Won. A real deal pipeline, or group by tag." />
          <Bento icon="bolt" title="Node automations" desc="Visual flows: a trigger (keyword, no-reply, new chat, broadcast) chained to actions — send, tag, set status." />

          <Bento icon="search" title="Command search" desc="⌘K to fuzzy-search every chat, multi-select, and bulk-add to folders." />
          <Bento icon="people" title="Contacts & relations" desc="Company, email, phone, notes, tags — and link people to the chats they're connected to." />
          <Bento icon="snippet" title="Snippets & composer" desc="Saved replies with ⌘-key shortcuts, a `/` picker, emoji, and platform-aware attachments." />

          <Bento
            className="sm:col-span-2"
            icon="sync"
            title="Two-way read sync"
            desc="Read a chat on your phone and the badge clears here; open it here and it marks read on the platform. Your inbox stays honest across devices."
          />
          <Bento icon="moon" title="Black dark mode" desc="A true-black theme with a slick circular-reveal toggle. Light mode too." />
        </div>
      </section>

      {/* Integrations */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <SectionLabel n="02" label="Channels" />
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Connect in a couple clicks
        </h2>
        <p className="mt-3 max-w-xl text-base text-slate-500 dark:text-neutral-400">
          No bot tokens to beg for. Each channel links the way you'd expect.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(
            [
              ["telegram", "Phone-code login — no app to create. You own the API app, users just enter their number."],
              ["whatsapp", "Scan a QR with your phone, exactly like WhatsApp Web. Stays linked in the background."],
              ["x", "A one-click Chrome extension hands off your X session securely with a pairing code."],
            ] as [Platform, string][]
          ).map(([p, desc]) => (
            <div
              key={p}
              className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700"
            >
              <span
                className="mb-4 grid h-11 w-11 place-items-center rounded-xl text-white shadow-sm"
                style={{ backgroundColor: PLATFORMS[p].bg }}
              >
                <PlatformGlyph platform={p} className="h-5 w-5" />
              </span>
              <div className="text-base font-semibold">{PLATFORMS[p].label}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Deploy */}
      <section id="deploy" className="mx-auto max-w-6xl px-5 py-20">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="grid gap-8 p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionLabel n="03" label="Deploy" />
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Ship it in minutes
              </h2>
              <p className="mt-3 max-w-md text-base text-slate-500 dark:text-neutral-400">
                It's self-hostable and agent-ready. Paste the prompt into Claude
                Code or Codex — it clones, configures the env, and deploys.
              </p>
              <ol className="mt-6 space-y-2.5 text-sm">
                {[
                  "Copy the deploy prompt",
                  "Paste it into your coding agent",
                  "It clones, sets env, and ships to Railway",
                ].map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">
                      {i + 1}
                    </span>
                    <span className="text-slate-600 dark:text-neutral-300">{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => copy("claude2")}
                  className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition hover:bg-accent"
                >
                  <CopyIcon active={copied === "claude2"} glyph="✳" />
                  {copied === "claude2" ? "Copied!" : "Deploy with Claude Code"}
                </button>
                <button
                  onClick={() => copy("codex2")}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
                >
                  <CopyIcon active={copied === "codex2"} glyph="◇" />
                  {copied === "codex2" ? "Copied!" : "Deploy with Codex"}
                </button>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-500 transition hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  View on GitHub ↗
                </a>
              </div>

              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200/90">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0">
                  <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
                <span>
                  <strong className="font-semibold">Run it on your own machine for the healthiest accounts.</strong>{" "}
                  WhatsApp and X flag logins from datacenter / cloud IPs — a home,
                  residential, or 5G connection (or a residential proxy) is much safer
                  than a bare server. Telegram is fine either way.
                </span>
              </div>
            </div>

            {/* Prompt preview */}
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1020] shadow-2xl">
              <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 font-mono text-[11px] text-white/40">deploy-prompt</span>
              </div>
              <pre className="max-h-60 overflow-hidden whitespace-pre-wrap px-4 py-4 font-mono text-[12.5px] leading-relaxed text-[#bff3da]/85">
{DEPLOY_PROMPT}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Custom integrations / paid support */}
      {/* Changelog */}
      {changelog.length > 0 && (
        <section id="changelog" className="mx-auto max-w-3xl px-5 py-20">
          <SectionLabel n="04" label="Changelog" />
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            What&apos;s new
          </h2>
          <p className="mt-3 text-slate-500 dark:text-neutral-400">
            Every release, in one place.
          </p>
          <div className="mt-10">
            <ChangelogList entries={changelog} />
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="relative flex flex-col items-center justify-between gap-5 overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-neutral-900 p-8 text-white sm:flex-row sm:p-10">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg"
              style={{ backgroundColor: PLATFORMS.telegram.bg }}
            >
              <PlatformGlyph platform="telegram" className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2 text-lg font-bold">
                Want a custom integration?
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">
                  Paid
                </span>
              </div>
              <p className="mt-1 text-sm text-white/70">
                Need another channel, a bespoke automation, or hands-on setup &
                support? DM the developer on Telegram.
              </p>
            </div>
          </div>
          <a
            href={TG_LINK}
            target="_blank"
            rel="noreferrer"
            className="relative shrink-0 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            Message dev on Telegram →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-neutral-900">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Own your inbox. Forever.
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-neutral-400">
            Self-hosted, open, and yours — no per-seat pricing, no data leaving
            your box.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <a
              href="#deploy"
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent"
            >
              Deploy it yourself →
            </a>
            <a
              href={TG_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Support
            </a>
          </div>
          <p className="mt-10 text-xs text-slate-400 dark:text-neutral-600">
            2 Many DMs · a self-hostable DM CRM
          </p>
        </div>
      </footer>
    </div>
  );
}

function CopyIcon({ active, glyph }: { active: boolean; glyph: string }) {
  if (active) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="animate-icon-pop h-4 w-4">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return <span className="text-base leading-none">{glyph}</span>;
}

function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-xs font-medium uppercase tracking-widest text-accent dark:text-accent">
      <span>{n}</span>
      <span className="h-px w-8 bg-accent/50 dark:bg-accent/40" />
      <span className="text-slate-400 dark:text-neutral-500">{label}</span>
    </div>
  );
}

function Bento({
  className = "",
  icon,
  title,
  desc,
  children,
}: {
  className?: string;
  icon: keyof typeof ICONS;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700 ${className}`}
    >
      <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent/18 to-accent/10 text-accent ring-1 ring-inset ring-accent/25 dark:text-accent">
        {ICONS[icon]}
      </span>
      <div className="text-base font-semibold">{title}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">
        {desc}
      </p>
      {children}
    </div>
  );
}

// Consistent stroke icon set (no emoji) — one visual family across all cards.
const ICONS = {
  triage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 12h4l2 3h6l2-3h4" />
      <path d="M5 5v7m14-7v7M5 19h14" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <rect x="3" y="4" width="5" height="13" rx="1.2" />
      <rect x="9.5" y="4" width="5" height="9" rx="1.2" />
      <rect x="16" y="4" width="5" height="16" rx="1.2" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4-4" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.6M17 19a5.5 5.5 0 0 0-2-4" />
    </svg>
  ),
  snippet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  ),
  sync: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 11a8 8 0 0 1 14-5l1 1m0 0h-4m4 0V3" />
      <path d="M21 13a8 8 0 0 1-14 5l-1-1m0 0h4m-4 0v4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ),
};

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5 dark:border-neutral-800 dark:bg-neutral-950 dark:ring-white/5">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-[11px] text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          app.2manydms.com
        </span>
      </div>
      {children}
    </div>
  );
}

// Interactive mini version of the real app — switch between Inbox / CRM / Automations.
type View = "inbox" | "board" | "flow";

function MockAvatar({ p, size = 8 }: { p: Platform; size?: number }) {
  return (
    <span className="relative shrink-0" style={{ height: size * 4, width: size * 4 }}>
      <span className="block h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-neutral-700 dark:to-neutral-800" />
      <span
        className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full text-white ring-2 ring-white dark:ring-neutral-950"
        style={{ backgroundColor: PLATFORMS[p].bg }}
      >
        <PlatformGlyph platform={p} className="h-2 w-2" />
      </span>
    </span>
  );
}

function AppMock() {
  const [view, setView] = useState<View>("inbox");
  const nav: { id: View; label: string; icon: React.ReactNode }[] = [
    {
      id: "inbox",
      label: "Inbox",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <path d="M3 12h4l2 3h6l2-3h4" />
          <path d="M5 7v5m14-5v5M5 18h14" />
        </svg>
      ),
    },
    {
      id: "board",
      label: "CRM",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <rect x="3" y="4" width="5" height="13" rx="1.2" />
          <rect x="9.5" y="4" width="5" height="9" rx="1.2" />
          <rect x="16" y="4" width="5" height="16" rx="1.2" />
        </svg>
      ),
    },
    {
      id: "flow",
      label: "Flows",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex h-80 bg-white text-left text-slate-900 dark:bg-neutral-950 dark:text-neutral-100 sm:h-[23rem]">
      {/* Left nav rail */}
      <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-slate-100 py-3 dark:border-neutral-800">
        <span className="mb-2 grid h-7 w-7 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-fg">
          ⌘
        </span>
        {nav.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setView(n.id)}
              className={`flex w-12 flex-col items-center gap-1 rounded-lg py-2 text-[9px] font-medium transition ${
                active
                  ? "bg-accent/15 text-accent dark:bg-accent/15 dark:text-accent"
                  : "text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
              }`}
            >
              {n.icon}
              {n.label}
            </button>
          );
        })}
      </div>

      {/* Active view */}
      <div className="min-w-0 flex-1">
        {view === "inbox" && <InboxView />}
        {view === "board" && <BoardView />}
        {view === "flow" && <FlowView />}
      </div>
    </div>
  );
}

function InboxView() {
  const rows = [
    { n: "Mx", m: "thanks — sending the invoice now", dot: "amber", p: "telegram" as Platform },
    { n: "shifu", m: "Will send when done", dot: "sky", p: "x" as Platform },
    { n: "Laura P", m: "Btw aussi pourrait marcher…", dot: "sky", badge: "32d", p: "whatsapp" as Platform },
    { n: "arrow", m: "In which situation would…", dot: "amber", p: "telegram" as Platform },
  ];
  return (
    <div className="flex h-full">
      <div className="flex w-1/2 flex-col border-r border-slate-100 dark:border-neutral-800">
        <div className="flex gap-1 border-b border-slate-100 p-3 dark:border-neutral-800">
          {["Needs reply", "Cold", "Done"].map((t, i) => (
            <span
              key={t}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                i === 0 ? "bg-accent text-accent-fg" : "text-slate-400 dark:text-neutral-500"
              }`}
            >
              {t}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3 border-b border-slate-50 px-3.5 py-3 dark:border-neutral-900">
            <MockAvatar p={r.p} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className={`h-1.5 w-1.5 rounded-full ${r.dot === "amber" ? "bg-amber-500" : "bg-sky-400"}`} />
                {r.n}
              </span>
              <span className="block truncate text-[11px] text-slate-400 dark:text-neutral-500">{r.m}</span>
            </span>
            {r.badge && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                {r.badge}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex w-1/2 flex-col">
        <div className="flex items-center gap-2.5 border-b border-slate-100 p-3 dark:border-neutral-800">
          <MockAvatar p="telegram" size={7} />
          <span className="text-[13px] font-semibold">Mx</span>
          <span className="ml-auto rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent dark:bg-accent/15 dark:text-accent">
            Lead
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-2 p-4">
          <div className="max-w-[82%] self-start rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-[12px] dark:bg-neutral-800">
            can you send me the repo?
          </div>
          <div className="max-w-[82%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[12px] text-accent-fg">
            Yeah — deploying it now ⚡
          </div>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[11px] text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
            Message Mx…
            <span className="ml-auto font-mono text-[10px]">/snippet</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardView() {
  const cols: { name: string; cards: { n: string; p: Platform; tag: string }[] }[] = [
    {
      name: "Lead",
      cards: [
        { n: "Mx", p: "telegram", tag: "Pricing" },
        { n: "arrow", p: "telegram", tag: "Inbound" },
      ],
    },
    { name: "Contacted", cards: [{ n: "shifu", p: "x", tag: "Demo" }] },
    { name: "Won", cards: [{ n: "Laura P", p: "whatsapp", tag: "Retainer" }] },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
        <span className="text-[13px] font-semibold">Pipeline</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
          4 deals
        </span>
      </div>
      <div className="flex flex-1 gap-2.5 overflow-hidden p-3">
        {cols.map((col) => (
          <div key={col.name} className="flex w-1/3 flex-col rounded-xl bg-slate-50 p-2 dark:bg-neutral-900">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold">{col.name}</span>
              <span className="text-[10px] text-slate-400 dark:text-neutral-500">{col.cards.length}</span>
            </div>
            <div className="space-y-2">
              {col.cards.map((c) => (
                <div
                  key={c.n}
                  className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
                >
                  <div className="flex items-center gap-2">
                    <MockAvatar p={c.p} size={6} />
                    <span className="text-[12px] font-semibold">{c.n}</span>
                  </div>
                  <span className="mt-1.5 inline-block rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent dark:bg-accent/15 dark:text-accent">
                    {c.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowView() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
        <span className="text-[13px] font-semibold">Automation</span>
        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
          Live
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-5">
        <FlowNode kind="when" title="When" body="New DM contains “pricing”" />
        <Connector />
        <FlowNode kind="then" title="Then" body="Send snippet · Pricing sheet" />
        <Connector />
        <FlowNode kind="then" title="Then" body="Tag contact · Lead → CRM" />
      </div>
    </div>
  );
}

function FlowNode({ kind, title, body }: { kind: "when" | "then"; title: string; body: string }) {
  const accent =
    kind === "when"
      ? "border-l-slate-400 text-slate-500 dark:border-l-neutral-500 dark:text-neutral-400"
      : "border-l-accent text-accent dark:text-accent";
  return (
    <div className={`w-full max-w-[16rem] rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 ${accent}`} style={{ borderLeftWidth: 3 }}>
      <div className="text-[10px] font-bold uppercase tracking-wide">{title}</div>
      <div className="text-[12px] font-medium text-slate-700 dark:text-neutral-200">{body}</div>
    </div>
  );
}

function Connector() {
  return <span className="h-4 w-px bg-slate-300 dark:bg-neutral-700" />;
}
