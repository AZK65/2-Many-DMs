"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ConversationDTO } from "@/lib/types";
import { CheckCircleIcon, PinIcon } from "./icons";

type StandaloneTask = {
  id: string;
  title: string;
  note: string | null;
  priority: boolean;
  completed: boolean;
  createdAt: string;
};

type TrayItem = {
  id: string;
  title: string;
  note: string | null;
  priority: boolean;
  conversationId: string | null;
  addedAt: string;
};

export function TodoTray({
  conversations,
  onOpenConversation,
  compact = false,
}: {
  conversations: ConversationDTO[];
  onOpenConversation: (id: string) => void;
  compact?: boolean;
}) {
  const [standalone, setStandalone] = useState<StandaloneTask[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = () => fetch("/api/todos")
      .then((response) => response.json())
      .then((tasks: StandaloneTask[]) => setStandalone(tasks))
      .catch(() => {});
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo<TrayItem[]>(() => [
    ...conversations
      .filter((conversation) => conversation.todo && !conversation.todoCompleted)
      .map((conversation) => ({
        id: `conversation:${conversation.id}`,
        title: conversation.contact.name,
        note: conversation.todoNote,
        priority: conversation.priority,
        conversationId: conversation.id,
        addedAt: conversation.todoAddedAt || conversation.lastMessageAt,
      })),
    ...standalone
      .filter((task) => !task.completed)
      .map((task) => ({
        id: `task:${task.id}`,
        title: task.title,
        note: task.note,
        priority: task.priority,
        conversationId: null,
        addedAt: task.createdAt,
      })),
  ].sort((a, b) => Number(b.priority) - Number(a.priority) || new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()), [conversations, standalone]);

  return (
    <aside className={compact ? "relative" : "mx-4 shrink-0 border-y border-slate-200 py-2 dark:border-neutral-800"} aria-label="Open tasks" onBlur={event => {
      if (compact && !event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
    }} onKeyDown={event => { if (event.key === "Escape") { setExpanded(false); event.currentTarget.querySelector("button")?.focus(); } }}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setExpanded((open) => !open)} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-slate-950 dark:hover:text-white" aria-expanded={expanded}>
          <span className="text-slate-400"><CheckCircleIcon className="h-4 w-4" /></span>
          <span className="text-xs font-medium text-slate-600 dark:text-neutral-300">Tasks</span>
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-neutral-700 dark:text-neutral-300">{items.length}</span>
          <span className={`text-xs text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {!compact && <Link href="/todos" className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors duration-200 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">View all</Link>}
      </div>

      {expanded && (
        <div className={compact ? "workspace-menu absolute right-0 top-full z-30 mt-2 w-64 space-y-1 p-2" : "mt-1.5 space-y-1"}>
          {items.length === 0 ? (
            <p className="px-1 pb-1 text-xs text-slate-400 dark:text-neutral-500">Nothing waiting right now.</p>
          ) : items.slice(0, 3).map((item) => (
            <button
              key={item.id}
              onClick={() => item.conversationId ? onOpenConversation(item.conversationId) : undefined}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${item.conversationId ? "cursor-pointer" : "cursor-default"} ${item.priority ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-transparent bg-white hover:border-slate-200 dark:bg-neutral-800 dark:hover:border-neutral-700"}`}
            >
              {item.priority ? <PinIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-neutral-600" />}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-neutral-200">{item.title}</span>
              {item.note && <span className="max-w-32 truncate text-xs text-slate-400 dark:text-neutral-500">{item.note}</span>}
            </button>
          ))}
          {items.length > 3 && <Link href="/todos" className="block px-1 pt-1 text-xs font-medium text-slate-400 hover:text-amber-700 dark:hover:text-amber-300">+{items.length - 3} more tasks</Link>}
          {compact && <Link href="/todos" className="workspace-menu-item">View all tasks</Link>}
        </div>
      )}
    </aside>
  );
}
