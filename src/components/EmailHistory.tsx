"use client";
import { OverlayPortal } from "./OverlayPortal";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Platform } from "@/lib/platforms";
import { PLATFORMS } from "@/lib/platforms";
import { Avatar } from "./Avatar";
import { CloseIcon, DownloadIcon, MailIcon, SearchIcon } from "./icons";

type Capture = {
  id: string; email: string; messageId: string; conversationId: string;
  copyCount: number; firstCopiedAt: string; copiedAt: string; sourceApp: string | null;
  contact: { name: string; handle: string; avatarUrl: string | null };
  conversation: { platform: Platform };
  message: { body: string; createdAt: string };
};

export function EmailHistory({ onClose, onOpen }: { onClose: () => void; onOpen: (conversationId: string, messageId: string) => void }) {
  const [items, setItems] = useState<Capture[]>([]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { fetch("/api/email-captures").then((r) => r.json()).then(setItems); }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((x) => `${x.email} ${x.contact.name} ${x.contact.handle}`.toLowerCase().includes(q)) : items;
  }, [items, query]);
  async function copy(item: Capture) {
    await navigator.clipboard.writeText(item.email);
    await fetch("/api/email-captures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
    setCopied(item.id); setTimeout(() => setCopied(null), 1400);
  }
  return <OverlayPortal onClose={onClose}><button type="button" aria-label="Dismiss email finder" className="fixed inset-0 bg-black/30" onClick={onClose} /><motion.aside role="dialog" aria-modal="true" aria-label="Email finder" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }} className="fixed inset-y-0 right-0 flex w-96 max-w-full flex-col border-l border-slate-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
    <header className="border-b border-slate-200 px-4 pb-3 pt-4 dark:border-neutral-800">
      <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-slate-900 dark:text-neutral-100">Email finder</h2><p className="text-xs text-slate-500 dark:text-neutral-400">Copied and discovered addresses with their source</p></div><div className="flex items-center gap-1"><a href="/api/email-captures/export" download className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-600 transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-200 active:scale-[0.98] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700" title="Export an agent-ready Excel workbook"><DownloadIcon className="h-3.5 w-3.5" />Excel</a><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800" aria-label="Close email finder"><CloseIcon /></button></div></div>
      <label className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 dark:bg-neutral-800"><SearchIcon className="h-4 w-4 text-slate-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" className="w-full bg-transparent py-2 text-sm outline-none dark:text-neutral-100" /></label>
    </header>
    <div className="scroll-thin flex-1 overflow-y-auto p-2">
      {!filtered.length && <div className="px-6 py-16 text-center"><MailIcon className="mx-auto mb-3 h-6 w-6 text-slate-300"/><p className="text-sm font-medium text-slate-600 dark:text-neutral-300">No matching emails</p><p className="mt-1 text-xs text-slate-400">Try an address, name, or handle.</p></div>}
      {filtered.map((item) => <div key={item.id} className="group rounded-xl p-3 transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-50 dark:hover:bg-neutral-800">
        <div className="flex gap-3"><Avatar name={item.contact.name} platform={item.conversation.platform} size="sm" src={item.contact.avatarUrl}/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><button onClick={() => onOpen(item.conversationId, item.messageId)} className="truncate text-left text-sm font-semibold text-slate-800 hover:text-accent dark:text-neutral-100">{item.contact.name}</button><span className="shrink-0 text-[10px] text-slate-400">{item.copyCount > 0 ? "Copied" : "Found"} · {PLATFORMS[item.conversation.platform].label}</span></div><button onClick={() => copy(item)} className="mt-1 flex max-w-full items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition active:scale-[0.98]"><MailIcon className="h-3.5 w-3.5"/><span className="truncate">{item.email}</span><span className="text-[10px] opacity-70">{copied === item.id ? "Copied" : "Copy"}</span></button>{item.sourceApp && <p className="mt-1 text-[10px] text-slate-400">Copied in {item.sourceApp}</p>}<button onClick={() => onOpen(item.conversationId, item.messageId)} className="mt-2 line-clamp-2 text-left text-xs leading-5 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300">{item.message.body}</button></div></div>
      </div>)}
    </div>
  </motion.aside></OverlayPortal>;
}
