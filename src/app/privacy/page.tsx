import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { websiteMetadata } from "@/lib/website-metadata";

export const metadata = websiteMetadata("Data & privacy — 2 Many DMs", "Understand what stays in your installation, what reaches a messaging platform, and what optional AI shares with a provider.", "/privacy");

const sections = [
  ["This website is not your inbox.", "The public preview contains fictional conversations. Clicking around does not connect accounts, send messages, or make an AI request. The appearance preference is saved in your browser. Website requests still reach the hosting service, which may keep ordinary access logs."],
  ["Your installation holds your history.", "Your synced messages, contacts, downloaded attachments, and account sessions are stored on the computer or server where you run 2Many. Treat that installation and its backups as sensitive. Encryption of stored credentials does not make the whole chat database encrypted or make a publicly exposed server safe."],
  ["Connections still talk to their platforms.", "Telegram, WhatsApp, X, and Discord connectors communicate with the respective services using your account. Downloading media and displaying remote avatars can also contact those services. Each provider’s policies, authentication requirements, and limits continue to apply."],
  ["AI is optional and uses an external provider.", "If you enable the chat assistant with an OpenRouter key, your questions and relevant synced conversation excerpts are sent through OpenRouter to the model provider to answer them. Usage is billed to your provider account. Skip AI during setup or disable it in Settings if you do not want that data flow. Other optional cloud features may have their own provider settings."],
  ["A server needs real access controls.", "A private local installation is the simplest starting point. Do not expose your personal workspace to the public internet without proper authentication and network controls. Use persistent storage, keep the encryption key private, and protect the machine that hosts your sessions."],
  ["Deleting data has more than one layer.", "Disconnecting a messaging account is not a guarantee that imported messages or backups have been deleted. Review stored data and backups separately. Removing a local copy does not delete the original messages held by the messaging platform or any information already sent to an AI provider."],
];

export default function PrivacyPage() {
  return <MarketingShell><main id="main-content" className="mx-auto max-w-5xl px-4 pb-8 pt-20 sm:px-8 sm:pt-24">
    <Link href="/landing" className="marketing-text-link">← Back to the workspace</Link>
    <p className="mt-12 text-sm font-medium text-accent">Data & privacy</p>
    <h1 className="marketing-heading mt-6 text-5xl font-semibold tracking-tighter sm:text-7xl">Know where<br />your chats go.</h1>
    <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-500 dark:text-neutral-400">A practical guide to the website and your personal installation. Hosting it yourself gives you control, not an automatic privacy guarantee.</p>
    <div className="mt-16">{sections.map(([title, description], index) => <section key={title} className="grid gap-6 border-t border-slate-200 py-8 sm:grid-cols-[4rem_minmax(0,1fr)] dark:border-neutral-800"><span className="text-sm text-accent">0{index + 1}</span><div><h2 className="text-2xl font-medium tracking-tight">{title}</h2><p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-500 dark:text-neutral-400">{description}</p></div></section>)}</div>
    <div className="mt-8 rounded-2xl bg-slate-100 p-8 dark:bg-neutral-900"><h2 className="text-xl font-medium">Something still unclear?</h2><p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">Repository members can ask a question in GitHub issues. Do not post private messages, session files, API keys, or account credentials.</p><a href="https://github.com/AZK65/2-Many-DMs/issues" target="_blank" rel="noopener noreferrer" className="marketing-text-link mt-6 inline-block">Open GitHub issues ↗</a><p className="mt-3 text-xs text-slate-400">Repository access required.</p></div>
  </main></MarketingShell>;
}
