"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ConversationDTO, FolderDTO } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms";
import { Avatar } from "./Avatar";
import { CheckIcon, FolderIcon, PlusIcon, SearchIcon } from "./icons";

// Rank a conversation against the (already lowercased) query tokens. Every
// token must hit some field (AND); the score rewards stronger matches so the
// most relevant chats float to the top.
function scoreConv(c: ConversationDTO, tokens: string[]): number {
  const name = c.contact.name.toLowerCase();
  const handle = c.contact.handle.toLowerCase();
  const last = (c.lastMessage ?? "").toLowerCase();
  const tags = c.contact.tags.map((t) => t.name.toLowerCase());
  const platform = PLATFORMS[c.platform].label.toLowerCase();

  let total = 0;
  for (const t of tokens) {
    let best = 0;
    if (name.startsWith(t)) best = 100;
    else if (new RegExp(`\\b${escapeRe(t)}`).test(name)) best = 80;
    else if (name.includes(t)) best = 60;
    else if (handle.includes(t)) best = 50;
    else if (tags.some((x) => x.includes(t))) best = 45;
    else if (platform.includes(t)) best = 35;
    else if (last.includes(t)) best = 20;
    if (best === 0) return -1; // token matched nothing → drop
    total += best;
  }
  return total;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function CommandPalette({
  conversations,
  folders,
  onClose,
  onOpenChat,
  onAddToFolder,
  onCreateFolder,
}: {
  conversations: ConversationDTO[];
  folders: FolderDTO[];
  onClose: () => void;
  onOpenChat: (id: string) => void;
  onAddToFolder: (convIds: string[], folderId: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<FolderDTO>;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState(0);
  const [mode, setMode] = useState<"list" | "folder">("list");
  const [folderQuery, setFolderQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return [...conversations]
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return (
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime()
          );
        })
        .slice(0, 60);
    }
    return conversations
      .map((c) => ({ c, s: scoreConv(c, tokens) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.c);
  }, [query, conversations]);

  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (mode === "list") inputRef.current?.focus();
    else folderInputRef.current?.focus();
  }, [mode]);

  // Keep the highlighted row in view during keyboard nav.
  useEffect(() => {
    const el = rowsRef.current?.querySelector<HTMLElement>(
      `[data-idx="${highlight}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const selectedList = [...selected];
  const folderResults = folders.filter((f) =>
    f.name.toLowerCase().includes(folderQuery.trim().toLowerCase())
  );
  const canCreate =
    folderQuery.trim().length > 0 &&
    !folders.some(
      (f) => f.name.toLowerCase() === folderQuery.trim().toLowerCase()
    );

  async function applyFolder(folderId: string) {
    if (selectedList.length === 0) return;
    setBusy(true);
    await onAddToFolder(selectedList, folderId);
    setBusy(false);
    onClose();
  }

  async function createAndApply() {
    if (!canCreate) return;
    setBusy(true);
    const folder = await onCreateFolder(folderQuery.trim());
    await onAddToFolder(selectedList, folder.id);
    setBusy(false);
    onClose();
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = results[highlight];
      if (!row) return;
      if ((e.metaKey || e.ctrlKey) && selected.size === 0) {
        onOpenChat(row.id);
        onClose();
      } else {
        toggle(row.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function onFolderKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canCreate) createAndApply();
      else if (folderResults[0]) applyFolder(folderResults[0].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMode("list");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "list" ? (
          <>
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 dark:border-neutral-800">
              <SearchIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-neutral-500" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey}
                placeholder="Search chats by name, handle, message, tag…"
                className="flex-1 bg-transparent py-3.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              {selected.size > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                >
                  Clear
                </button>
              )}
            </div>

            <div ref={rowsRef} className="scroll-thin flex-1 overflow-y-auto p-1.5">
              {results.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-slate-400 dark:text-neutral-500">
                  No chats match “{query}”.
                </div>
              )}
              {results.map((c, i) => {
                const isSel = selected.has(c.id);
                return (
                  <div
                    key={c.id}
                    data-idx={i}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => toggle(c.id)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition ${
                      i === highlight
                        ? "bg-slate-100 dark:bg-neutral-800"
                        : "hover:bg-slate-50 dark:hover:bg-neutral-800/50"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${
                        isSel
                          ? "border-[#1FE88A] bg-[#1FE88A] text-[#04140d]"
                          : "border-slate-300 dark:border-neutral-600"
                      }`}
                    >
                      {isSel && <CheckIcon className="h-3.5 w-3.5" />}
                    </span>
                    <Avatar
                      name={c.contact.name}
                      platform={c.platform}
                      size="sm"
                      src={c.contact.avatarUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">
                        {c.contact.name}
                      </div>
                      <div className="truncate text-xs text-slate-400 dark:text-neutral-500">
                        {c.lastMessage || c.contact.handle}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenChat(c.id);
                        onClose();
                      }}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      style={{ opacity: i === highlight ? 1 : undefined }}
                    >
                      Open ↵
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-neutral-800">
              {selected.size > 0 ? (
                <>
                  <span className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                    {selected.size} selected
                  </span>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setMode("folder")}
                    className="flex items-center gap-1.5 rounded-lg bg-[#1FE88A] px-3 py-1.5 text-xs font-semibold text-[#04140d] transition hover:bg-[#16d579]"
                  >
                    <FolderIcon className="h-3.5 w-3.5" />
                    Add to folder
                  </motion.button>
                </>
              ) : (
                <span className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-neutral-500">
                  <span>
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd> navigate
                  </span>
                  <span>
                    <Kbd>↵</Kbd> select
                  </span>
                  <span>
                    <Kbd>⌘↵</Kbd> open
                  </span>
                  <span>
                    <Kbd>esc</Kbd> close
                  </span>
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
              <button
                onClick={() => setMode("list")}
                className="rounded-md px-1.5 py-0.5 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">
                Add {selected.size} chat{selected.size === 1 ? "" : "s"} to…
              </span>
            </div>
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 dark:border-neutral-800">
              <FolderIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-neutral-500" />
              <input
                ref={folderInputRef}
                autoFocus
                value={folderQuery}
                onChange={(e) => setFolderQuery(e.target.value)}
                onKeyDown={onFolderKey}
                placeholder="Filter folders or type a new name…"
                className="flex-1 bg-transparent py-3.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>
            <div className="scroll-thin max-h-72 flex-1 overflow-y-auto p-1.5">
              {canCreate && (
                <button
                  onClick={createAndApply}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1FE88A]/15 text-[#0e9f63] dark:bg-[#1FE88A]/15 dark:text-[#1FE88A]">
                    <PlusIcon className="h-4 w-4" />
                  </span>
                  <span className="text-sm text-slate-700 dark:text-neutral-200">
                    Create folder{" "}
                    <span className="font-semibold">“{folderQuery.trim()}”</span>
                  </span>
                </button>
              )}
              {folderResults.map((f) => (
                <button
                  key={f.id}
                  onClick={() => applyFolder(f.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                    <FolderIcon className="h-4 w-4" />
                  </span>
                  <span className="text-sm text-slate-700 dark:text-neutral-200">
                    {f.name}
                  </span>
                </button>
              ))}
              {folderResults.length === 0 && !canCreate && (
                <div className="px-3 py-8 text-center text-sm text-slate-400 dark:text-neutral-500">
                  No folders yet.
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded bg-slate-100 px-1 py-0.5 font-sans text-[10px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </kbd>
  );
}
