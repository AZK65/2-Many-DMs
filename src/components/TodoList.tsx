"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ConversationDTO } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms";
import { listTime } from "@/lib/time";
import { Avatar } from "./Avatar";
import { CheckCircleIcon, CloseIcon, PinIcon } from "./icons";
import { WorkspaceHeader } from "./WorkspaceHeader";

type TodoFilter = "open" | "completed";

type StandaloneTask = {
  id: string;
  title: string;
  note: string | null;
  priority: boolean;
  completed: boolean;
  createdAt: string;
};

export function TodoList() {
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [filter, setFilter] = useState<TodoFilter>("open");
  const [standalone, setStandalone] = useState<StandaloneTask[]>([]);
  const [newTask, setNewTask] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/conversations").then((response) => response.json()),
      fetch("/api/todos").then((response) => response.json()),
    ])
      .then(([conversationData, taskData]: [ConversationDTO[], StandaloneTask[]]) => {
        setConversations(conversationData);
        setStandalone(taskData);
      })
      .finally(() => setLoading(false));
  }, []);

  const tasks = useMemo(
    () => conversations
      .filter((conversation) => conversation.todo && conversation.todoCompleted === (filter === "completed"))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return new Date(b.todoAddedAt || b.lastMessageAt).getTime() - new Date(a.todoAddedAt || a.lastMessageAt).getTime();
      }),
    [conversations, filter]
  );

  const standaloneTasks = useMemo(
    () => standalone
      .filter((task) => task.completed === (filter === "completed"))
      .sort((a, b) => Number(b.priority) - Number(a.priority) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [standalone, filter]
  );

  async function createStandaloneTask(event: FormEvent) {
    event.preventDefault();
    const title = newTask.trim();
    if (!title) return;
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) return;
    const task: StandaloneTask = await response.json();
    setStandalone((items) => [task, ...items]);
    setNewTask("");
    setFilter("open");
  }

  async function updateStandalone(id: string, patch: Partial<StandaloneTask>) {
    setStandalone((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  async function removeStandalone(id: string) {
    setStandalone((items) => items.filter((item) => item.id !== id));
    await fetch(`/api/todos/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function update(id: string, patch: Partial<ConversationDTO>) {
    setConversations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    setSavingId(id);
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
    setSavingId(null);
  }

  return (
    <main className="workspace-page flex min-h-screen flex-col bg-slate-100 dark:bg-black">
      <WorkspaceHeader />

      <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-10">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-amber-600 dark:text-amber-400">Conversation tasks</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Follow through without losing the chat.</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-neutral-400">Every item links back to its conversation. Keep the next action beside the person who needs it.</p>
          </div>
          <div className="flex rounded-lg bg-slate-200 p-1 text-sm font-medium dark:bg-neutral-800">
            {(["open", "completed"] as TodoFilter[]).map((value) => (
              <button key={value} onClick={() => setFilter(value)} className={`rounded-md px-3 py-1.5 capitalize transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${filter === value ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>{value}</button>
            ))}
          </div>
        </div>

        <form onSubmit={createStandaloneTask} className="mb-8 flex gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <input
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            placeholder="Add a task that is not linked to a conversation…"
            aria-label="New task"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-neutral-100"
          />
          <button disabled={!newTask.trim()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white">Add task</button>
        </form>

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-neutral-900" />)}</div>
        ) : tasks.length === 0 && standaloneTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-8 py-20 text-center dark:border-neutral-700">
            <CheckCircleIcon className="mx-auto mb-3 h-7 w-7 text-slate-400" />
            <h2 className="font-semibold text-slate-800 dark:text-neutral-200">{filter === "open" ? "No open tasks" : "No completed tasks yet"}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Use the three-dot menu on a conversation to add it here.</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {standaloneTasks.map((task) => (
                <motion.article key={task.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border bg-white p-4 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] dark:bg-neutral-900 ${task.priority ? "border-amber-400 shadow-[0_8px_30px_rgba(217,119,6,0.12)] dark:border-amber-500/70" : "border-slate-200 dark:border-neutral-800"}`}>
                  <button onClick={() => updateStandalone(task.id, { completed: !task.completed })} className="mt-0.5 rounded-full text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-emerald-600 active:scale-[0.98] dark:hover:text-emerald-400" title={task.completed ? "Reopen task" : "Complete task"}><CheckCircleIcon className="h-5 w-5" /></button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <input value={task.title} onChange={(event) => setStandalone((items) => items.map((item) => item.id === task.id ? { ...item, title: event.target.value } : item))} onBlur={(event) => updateStandalone(task.id, { title: event.target.value })} className={`min-w-0 flex-1 bg-transparent font-semibold text-slate-900 outline-none dark:text-neutral-100 ${task.completed ? "line-through opacity-50" : ""}`} />
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">Standalone</span>
                      {task.priority && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Priority</span>}
                    </div>
                    <input value={task.note || ""} onChange={(event) => setStandalone((items) => items.map((item) => item.id === task.id ? { ...item, note: event.target.value } : item))} onBlur={(event) => updateStandalone(task.id, { note: event.target.value })} placeholder="Add a note or next step…" className="mt-2 w-full bg-transparent text-sm text-slate-500 outline-none placeholder:text-slate-400 dark:text-neutral-400" />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => updateStandalone(task.id, { priority: !task.priority })} title={task.priority ? "Remove priority" : "Mark priority"} className={`rounded-lg p-2 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${task.priority ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800"}`}><PinIcon className="h-4 w-4" /></button>
                    <button onClick={() => removeStandalone(task.id)} title="Delete task" className="rounded-lg p-2 text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-red-50 hover:text-red-500 active:scale-[0.98] dark:hover:bg-red-500/10"><CloseIcon className="h-4 w-4" /></button>
                  </div>
                </motion.article>
              ))}
              {tasks.map((task) => (
                <motion.article key={task.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] gap-4 rounded-xl border bg-white p-4 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] dark:bg-neutral-900 ${task.priority ? "border-amber-400 shadow-[0_8px_30px_rgba(217,119,6,0.12)] dark:border-amber-500/70" : "border-slate-200 dark:border-neutral-800"}`}>
                  <Link href={`/?conversation=${task.id}`} className="rounded-full focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-black">
                    <Avatar name={task.contact.name} platform={task.platform} size="md" src={task.contact.avatarUrl} />
                  </Link>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/?conversation=${task.id}`} className="truncate font-semibold text-slate-900 hover:underline dark:text-neutral-100">{task.contact.name}</Link>
                      <span className="text-xs text-slate-400">{PLATFORMS[task.platform].label}</span>
                      {task.priority && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Priority</span>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{task.lastMessage || "No message preview"} · {listTime(task.lastMessageAt)}</p>
                    <input
                      value={task.todoNote || ""}
                      onChange={(event) => setConversations((items) => items.map((item) => item.id === task.id ? { ...item, todoNote: event.target.value } : item))}
                      onBlur={(event) => update(task.id, { todoNote: event.target.value } as Partial<ConversationDTO>)}
                      placeholder="Add the next action or context…"
                      className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </div>
                  <div className="flex items-start gap-1">
                    <button onClick={() => update(task.id, { priority: !task.priority })} title={task.priority ? "Remove priority" : "Mark priority"} className={`rounded-lg p-2 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${task.priority ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800"}`}><PinIcon className="h-4 w-4" /></button>
                    <button onClick={() => update(task.id, { todoCompleted: !task.todoCompleted })} title={task.todoCompleted ? "Reopen task" : "Complete task"} className="rounded-lg p-2 text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-emerald-50 hover:text-emerald-600 active:scale-[0.98] dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"><CheckCircleIcon className="h-4 w-4" /></button>
                    <button onClick={() => update(task.id, { todo: false, todoNote: null })} title="Remove from to-do" className="rounded-lg p-2 text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-red-50 hover:text-red-500 active:scale-[0.98] dark:hover:bg-red-500/10"><CloseIcon className="h-4 w-4" /></button>
                  </div>
                  {savingId === task.id && <span className="col-start-2 text-xs text-slate-400">Saving…</span>}
                </motion.article>
              ))}
            </div>
          </AnimatePresence>
        )}
      </section>
    </main>
  );
}
