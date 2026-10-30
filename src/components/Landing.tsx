"use client";

import { useState } from "react";
import Link from "next/link";
import { MarketingShell, Reveal } from "./marketing/MarketingShell";
import { ProductDemo, type DemoView } from "./marketing/ProductDemo";
import { BrandMark } from "./marketing/BrandMark";
import { FeatureBento } from "./marketing/FeatureBento";
import { OnboardingPreview } from "./marketing/OnboardingPreview";
import { GetStartedButton } from "./marketing/SetupPrompt";
import { Questions } from "./marketing/Questions";
import type { Platform } from "@/lib/platforms";
import releases from "../../public/changelog.json";

const connections = [
  { id: "telegram", name: "Telegram", caption: "Your chats, groups, and channels.", heading: "A small setup. Then your whole world.", description: "Connect your own Telegram account, search synced conversations, and keep the people in every group easy to recognize.", steps: ["Create an app at my.telegram.org/apps to get your API ID and API hash.", "Enter those credentials and your phone number in Connections.", "Enter the code Telegram sends you, then your two step password if enabled."], note: "The app credentials are required once. The setup guide walks you through each field.", link: "https://my.telegram.org/apps", linkLabel: "Open Telegram app setup" },
  { id: "whatsapp", name: "WhatsApp", caption: "Personal chats and busy groups.", heading: "Scan once. Get the conversation going.", description: "Bring WhatsApp conversations into the same inbox, with recognizable group members, attachments, and saved history.", steps: ["Choose WhatsApp in Connections and wait for a fresh QR code.", "On your phone, open WhatsApp → Settings → Linked devices → Link a device.", "Scan the code and keep your phone online while the first sync starts."], note: "History availability depends on WhatsApp. A revoked linked device will need a new scan." },
  { id: "x", name: "X", caption: "DMs, without another open inbox.", heading: "Keep the conversation after the post.", description: "Pair your logged in browser with your workspace. See messages and connection health together, so a paused sync is visible.", steps: ["Download the connector extension from the workspace and add it to Chrome.", "Open X in that browser and sign in to your own account.", "Enter the workspace pairing code. Unlock X Chat with your passcode if prompted."], note: "X uses a browser connector, not an official integration. Provider limits and encrypted chat unlock can affect syncing." },
  { id: "discord", name: "Discord", caption: "Find the detail buried in a DM.", heading: "A searchable memory for your DMs.", description: "Index private Discord chats and group DMs, search for an email or phrase, then open the original conversation.", steps: ["Run the workspace on a computer with a desktop and Chrome available.", "Choose Discord in Connections and sign in in the local browser window.", "Let the initial history index finish. Leave the connection running for new messages."], note: "Discord is read only here. Local sign in is required; a headless VPS cannot show the login window or reuse your desktop app session." },
] as const;

const questions = [
  ["Is this another hosted inbox?", "No. You run your own workspace on your computer or a private server. Your database and saved account sessions live on that installation. You are responsible for its access controls and backups."],
  ["Can I install it right now?", "Yes. The GitHub repository is public, and anyone can clone it. Use the guided setup prompt to install it on your computer. The website is a demo, not a login to your messages."],
  ["Do I need AI to use it?", "No. Connecting an OpenRouter key is optional and you can skip it during onboarding. Inbox search, messaging, and the rest of the workspace do not require the chat assistant."],
  ["Where does the AI send my chats?", "When you ask the assistant a question, relevant synced chat excerpts are sent through OpenRouter to the selected model provider. Model usage is billed through your own OpenRouter account. Never connect AI if that does not fit your data requirements."],
  ["Will every old message appear?", "History depth varies by platform and account. Initial indexing can take time, and some attachments need to be recovered from the original service. The workspace shows sync state and offers history controls; it cannot promise complete provider history."],
  ["Can I put everything on a VPS?", "Some connectors can run on a server, but browser connections still need the right environment. Discord setup requires a local desktop browser. Keep any remote workspace private, use persistent storage, and follow the connection guide before moving accounts."],
  ["Can I reply on all four platforms?", "Telegram, WhatsApp, and X support messaging through their connected accounts. Discord is currently for reading, searching, and opening the original conversation—not sending from this workspace."],
  ["Are there extra costs or platform risks?", "Your hosting, optional AI usage, and any external services are separate. These connectors are independent of the messaging platforms. Their rules, rate limits, login requirements, and availability still apply."],
];

export function Landing() {
  const [view, setView] = useState<DemoView>("inbox");
  const [connection, setConnection] = useState(0);
  const current = connections[connection];
  const latest = releases.entries[0];
  function showDemo(next: DemoView) {
    setView(next); document.getElementById("demo")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  }
  return <MarketingShell>
    <main id="main-content">
      <section className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-8 sm:pt-24">
        <p className="mb-8 flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-neutral-400"><span className="h-2 w-2 rounded-full bg-accent" />Your independent messaging workspace</p>
        <div className="grid items-end gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-16">
          <h1 className="marketing-heading max-w-3xl text-5xl font-semibold tracking-tighter sm:text-7xl xl:text-8xl">Your people.<br />Not your tabs.</h1>
          <div className="max-w-md lg:pb-2"><p className="text-lg leading-relaxed text-slate-500 dark:text-neutral-400">Telegram. WhatsApp. X. Discord.<br />One place to find the thread, remember the detail, and keep things moving.</p><div className="mt-8 flex flex-wrap items-center gap-6"><GetStartedButton /><button onClick={() => showDemo("inbox")} type="button" className="marketing-text-link">Try the demo <span aria-hidden>↘</span></button></div><p className="mt-4 text-xs text-slate-400 dark:text-neutral-500">Set up with Codex, Cursor, or Claude Code. Your machine, your workspace.</p></div>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-6 sm:gap-8">{connections.map(item => <span key={item.id} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-neutral-400"><BrandMark platform={item.id as Platform} className="h-10 w-10" />{item.name}{item.id === "discord" && <span className="text-xs text-slate-400 dark:text-neutral-500">search</span>}</span>)}</div>
      </section>

      <section id="demo" aria-label="Interactive workspace preview" className="mx-auto max-w-7xl px-4 sm:px-8"><ProductDemo view={view} onView={setView} /><p className="mt-4 text-center text-xs text-slate-400 dark:text-neutral-500">A working preview with fictional conversations. Your real workspace stays private.</p></section>

      <FeatureBento onDemo={showDemo} />

      <section id="connections" className="bg-slate-50 py-20 dark:bg-neutral-900"><div className="mx-auto max-w-7xl px-4 sm:px-8"><Reveal><div className="grid gap-6 lg:grid-cols-2"><h2 className="text-4xl font-medium tracking-tight sm:text-5xl">Same people.<br />Fewer places to look.</h2><p className="max-w-md text-lg leading-relaxed text-slate-500 lg:ml-auto dark:text-neutral-400">Each platform works differently. Your setup should explain that, not make you figure it out.</p></div></Reveal>
        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_2fr] lg:gap-16"><div role="tablist" aria-label="Connection guides" aria-orientation="vertical" className="grid grid-cols-2 gap-2 lg:block lg:space-y-2">{connections.map((item, index) => <button key={item.id} id={`connection-${item.id}`} role="tab" aria-selected={connection === index} aria-controls="connection-guide" tabIndex={connection === index ? 0 : -1} onClick={() => setConnection(index)} onKeyDown={event => { const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0; if (!offset && event.key !== "Home" && event.key !== "End") return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? connections.length - 1 : (connection + offset + connections.length) % connections.length; setConnection(next); document.getElementById(`connection-${connections[next].id}`)?.focus(); }} className={`flex w-full items-center gap-4 rounded-xl p-4 text-left transition-colors duration-200 ${connection === index ? "bg-white shadow-sm dark:bg-neutral-800" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800/50"}`}><BrandMark platform={item.id as Platform} className="h-10 w-10" /><span><span className="text-base font-medium">{item.name}</span><span className="mt-1 hidden text-xs text-slate-500 lg:block dark:text-neutral-400">{item.caption}</span></span><span className="ml-auto hidden lg:block" aria-hidden>{connection === index ? "↗" : ""}</span></button>)}</div>
          <div id="connection-guide" role="tabpanel" tabIndex={0} aria-labelledby={`connection-${current.id}`} className="min-w-0"><h3 className="text-2xl font-medium tracking-tight sm:text-3xl">{current.heading}</h3><p className="mt-4 max-w-xl text-base leading-relaxed text-slate-500 dark:text-neutral-400">{current.description}</p><ol className="my-8 space-y-6">{current.steps.map((step, index) => <li key={step} className="flex items-start gap-4 text-sm leading-relaxed"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-200 text-xs tabular-nums dark:bg-neutral-800">0{index + 1}</span><span className="pt-1">{step}</span></li>)}</ol><p className="max-w-xl text-xs leading-relaxed text-slate-500 dark:text-neutral-400">{current.note}</p>{"link" in current && <a href={current.link} target="_blank" rel="noopener noreferrer" className="marketing-text-link mt-6 inline-block">{current.linkLabel} <span aria-hidden>↗</span></a>}</div>
        </div>
      </div></section>

      <OnboardingPreview />

      <section id="setup" className="mx-auto max-w-7xl px-4 py-24 sm:px-8"><Reveal><div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16"><div><p className="mb-6 text-sm font-medium text-accent">Your accounts. Your workspace.</p><h2 className="text-4xl font-medium tracking-tight sm:text-5xl">Make room for<br />better conversations.</h2><p className="mt-6 max-w-md text-base leading-relaxed text-slate-500 dark:text-neutral-400">Run 2Many on your computer. Local models for translation, image text search, and autocorrect are part of the guided setup. Cloud chat AI is optional.</p><p className="mt-6 max-w-md text-sm leading-relaxed text-slate-500 dark:text-neutral-400">The code is public on GitHub. No invitation needed. Clone it yourself or let your coding assistant guide the installation.</p><a href="https://github.com/AZK65/2-Many-DMs" target="_blank" rel="noopener noreferrer" className="marketing-text-link mt-6 inline-block">Open repository <span aria-hidden>↗</span></a></div><div className="rounded-2xl bg-slate-100 p-6 sm:p-8 dark:bg-neutral-900"><h3 className="text-xl font-medium">Your assistant can take it from here.</h3><p className="mt-4 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">A ready to paste prompt for Codex, Cursor, or Claude Code. It checks your machine, installs missing models after your confirmation, and walks you through connecting your accounts.</p><ol className="my-8 space-y-6 text-sm"><li className="flex gap-4"><span className="text-accent">01</span>Choose your coding assistant.</li><li className="flex gap-4"><span className="text-accent">02</span>Copy the prompt and review the installation.</li><li className="flex gap-4"><span className="text-accent">03</span>Connect your accounts in your own workspace.</li></ol><GetStartedButton>Choose your setup prompt <span aria-hidden>↗</span></GetStartedButton><p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">Nothing installs until you run setup on your computer. Local models require several GB and compatible hardware.</p></div></div></Reveal></section>

      <section id="questions" className="mx-auto max-w-7xl px-4 sm:px-8"><Reveal><div className="border-t border-slate-200 pt-16 dark:border-neutral-800"><p className="text-sm font-medium text-accent">Good questions.</p><h2 className="mt-4 text-4xl font-medium tracking-tight sm:text-5xl">Before you connect.</h2></div></Reveal><Questions items={questions} /><p className="mt-8 text-sm"><Link href="/privacy" className="marketing-text-link">Read how your data moves <span aria-hidden>↗</span></Link></p></section>

      <section className="mx-auto max-w-7xl px-4 pb-4 pt-24 sm:px-8"><Link href="/changelog" className="group flex flex-col justify-between gap-6 rounded-2xl bg-slate-100 p-6 transition-colors duration-200 hover:bg-slate-200 sm:flex-row sm:items-center sm:p-8 dark:bg-neutral-900 dark:hover:bg-neutral-800"><div><p className="text-xs text-accent">Latest release · v{latest.version}</p><h2 className="mt-3 text-xl font-medium tracking-tight sm:text-2xl">{latest.title}</h2></div><span className="shrink-0 text-sm font-medium">Read the updates <span aria-hidden className="inline-block transition-transform duration-200 group-hover:translate-x-1">↗</span></span></Link></section>
    </main>
  </MarketingShell>;
}
