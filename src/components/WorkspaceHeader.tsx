"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { SettingsModal } from "./SettingsModal";
import { ChatAssistant } from "./ChatAssistant";
import ThemeToggle from "./ThemeToggle";
import { MenuDetails } from "./MenuDetails";
import { MoreIcon, MailIcon, SheetIcon, CheckCircleIcon, UserIcon, SettingsIcon } from "./icons";

const primary = [["/", "Inbox"], ["/board", "Board"], ["/todos", "Tasks"], ["/network", "Network"]];
const secondary = [["/reply-lab", "Reply Lab"], ["/automations", "Automations"], ["/listening", "Listening"]];
const navIcons = [MailIcon, SheetIcon, CheckCircleIcon, UserIcon];

/** One navigation vocabulary across the workspace, separate from inbox filters. */
export function WorkspaceHeader({ brand, actions, assistant, onOpenEmails, onOpenSettings, showUtilities = true, rail = true }: { brand?: ReactNode; actions?: ReactNode; assistant?: ReactNode; onOpenEmails?: () => void; onOpenSettings?: () => void; showUtilities?: boolean; rail?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const pathname = usePathname();
  const secondaryPage = secondary.find(([href]) => pathname === href);
  const itemClass = (active: boolean) => `workspace-nav-item ${active ? "workspace-nav-active" : ""}`;
  return <><header className={`workspace-header ${rail ? "workspace-header-rail" : ""}`}>
    <div className="workspace-brand-slot">{brand || <Link href="/" className="workspace-brand" aria-label="Omni CRM inbox">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/icon-light.png" alt="" className="h-6 w-6 dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/icon-dark.png" alt="" className="hidden h-6 w-6 dark:block" />
      <span>omni<span className="ml-1 font-normal text-slate-400">crm</span></span>
    </Link>}</div>
    <nav aria-label="Workspace" className="workspace-navigation flex min-w-0 items-center gap-1 sm:ml-8">
      {primary.map(([href, label], index) => { const Icon = navIcons[index]; return <Link key={href} href={href} title={label} aria-label={label} aria-current={pathname === href ? "page" : undefined}
        className={`${itemClass(pathname === href)} ${pathname !== href ? "hidden sm:flex" : ""}`}>{rail && <Icon className="workspace-nav-icon h-5 w-5" />}<span className="workspace-nav-label">{label}</span></Link>; })}
      <MenuDetails className="relative">
        <summary aria-label="More workspace pages" className={`${itemClass(!!secondaryPage)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><MoreIcon className="h-4 w-4" /></summary>
        <div className="workspace-menu fixed inset-x-3 top-16 z-50 p-2 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-56">
          <div className="sm:hidden">{primary.map(([href, label]) => <Link key={href} href={href} className="workspace-menu-item">{label}</Link>)}</div>
          {secondary.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="workspace-menu-item">{label}</Link>)}
          {onOpenEmails && <button type="button" data-close-menu onClick={onOpenEmails} className="workspace-menu-item w-full text-left">Copied emails</button>}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 px-3 pt-2 dark:border-neutral-700"><span className="text-xs text-slate-500">Appearance</span><ThemeToggle /></div>
        </div>
      </MenuDetails>
      {secondaryPage && <span aria-current="page" title={secondaryPage[1]} className="workspace-secondary-label workspace-nav-item workspace-nav-active truncate">{secondaryPage[1]}</span>}
    </nav>
    <div className="workspace-header-actions ml-auto flex shrink-0 items-center gap-2">{actions}
      {showUtilities && <button type="button" title="Settings" aria-label="Open settings" aria-haspopup="dialog" onClick={onOpenSettings || (() => setSettingsOpen(true))} className="rail-control"><SettingsIcon className="h-5 w-5" /></button>}
      {showUtilities && (assistant || <ChatAssistant onOpenSettings={() => { setAiSettings(true); setSettingsOpen(true); }} />)}
    </div>
  </header><AnimatePresence>{settingsOpen && <SettingsModal initialPage={aiSettings ? "ai" : "general"} onClose={() => { setSettingsOpen(false); setAiSettings(false); }} />}</AnimatePresence></>;
}
