"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SnippetDTO } from "@/lib/types";
import { ZapIcon, TrashIcon, PlusIcon } from "./icons";

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

export function SnippetsModal({
  snippets,
  onClose,
  onChange,
}: {
  snippets: SnippetDTO[];
  onClose: () => void;
  onChange: (snippets: SnippetDTO[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");

  async function create() {
    if (!title.trim() || !text.trim()) return;
    const res = await fetch("/api/snippets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text, shortcut }),
    });
    const snippet: SnippetDTO = await res.json();
    onChange([...snippets, snippet]);
    setTitle("");
    setShortcut("");
    setText("");
  }

  async function update(id: string, patch: Partial<SnippetDTO>) {
    onChange(snippets.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await fetch(`/api/snippets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  async function remove(id: string) {
    onChange(snippets.filter((s) => s.id !== id));
    await fetch(`/api/snippets/${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
              <ZapIcon className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold dark:text-neutral-100">
              Snippets
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-xs text-slate-500 dark:text-neutral-400">
            Insert a saved phrase with{" "}
            <kbd className="rounded bg-slate-100 px-1 font-medium dark:bg-neutral-700">
              {MOD}
            </kbd>{" "}
            + its key, or type{" "}
            <kbd className="rounded bg-slate-100 px-1 font-medium dark:bg-neutral-700">
              /
            </kbd>{" "}
            in the message box to pick one.
          </p>

          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {snippets.map((s) => (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="group rounded-xl border border-slate-200 p-3 dark:border-neutral-700"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <input
                      value={s.title}
                      onChange={(e) =>
                        onChange(
                          snippets.map((x) =>
                            x.id === s.id ? { ...x, title: e.target.value } : x
                          )
                        )
                      }
                      onBlur={(e) => update(s.id, { title: e.target.value })}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-neutral-100"
                      placeholder="Title"
                    />
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-neutral-500">
                      {MOD}
                      <span>+</span>
                      <input
                        value={s.shortcut ?? ""}
                        maxLength={1}
                        onChange={(e) =>
                          onChange(
                            snippets.map((x) =>
                              x.id === s.id
                                ? { ...x, shortcut: e.target.value || null }
                                : x
                            )
                          )
                        }
                        onBlur={(e) => update(s.id, { shortcut: e.target.value })}
                        placeholder="–"
                        className="h-6 w-7 rounded border border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase text-slate-700 outline-none focus:border-blue-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200"
                      />
                    </div>
                    <button
                      onClick={() => remove(s.id)}
                      aria-label="Delete snippet"
                      className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-neutral-700"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    value={s.text}
                    rows={2}
                    onChange={(e) =>
                      onChange(
                        snippets.map((x) =>
                          x.id === s.id ? { ...x, text: e.target.value } : x
                        )
                      )
                    }
                    onBlur={(e) => update(s.id, { text: e.target.value })}
                    className="w-full resize-none rounded-lg bg-slate-100 p-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:ring-blue-500/40"
                  />
                </motion.div>
              ))}
            </AnimatePresence>
            {snippets.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 dark:border-neutral-700 dark:text-neutral-500">
                No snippets yet — add your first below.
              </div>
            )}
          </div>
        </div>

        {/* New snippet form */}
        <div className="border-t border-slate-200 p-4 dark:border-neutral-700">
          <div className="mb-2 flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (e.g. Pricing)"
              className="min-w-0 flex-1 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-blue-500/40"
            />
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 text-xs text-slate-400 dark:bg-neutral-700 dark:text-neutral-500">
              {MOD}+
              <input
                value={shortcut}
                maxLength={1}
                onChange={(e) => setShortcut(e.target.value)}
                placeholder="key"
                className="h-7 w-10 bg-transparent text-center text-sm font-medium uppercase text-slate-700 outline-none placeholder:text-slate-400 placeholder:normal-case dark:text-neutral-200"
              />
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="The phrase to insert…"
            className="mb-2 w-full resize-none rounded-lg bg-slate-100 p-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-blue-500/40"
          />
          <div className="flex justify-end">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={create}
              disabled={!title.trim() || !text.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              <PlusIcon className="h-4 w-4" />
              Add snippet
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
