"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { ConversationDTO, MessageDTO } from "@/lib/types";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { Avatar } from "./Avatar";

// Forward a message to one or more chats on any platform. Each target sends
// through its own adapter, so it's inherently cross-platform.
export function ForwardModal({
  message,
  onClose,
  onDone,
}: {
  message: MessageDTO;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((c: ConversationDTO[]) => setConversations(c))
      .catch(() => {});
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => !q || c.contact.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [conversations, query]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function forward() {
    if (!selected.size || sending) return;
    setSending(true);
    setError(null);
    const payload: { body: string; media?: { type: string; url: string; name: string } } =
      { body: message.body };
    if (message.mediaType && message.mediaUrl) {
      payload.media = {
        type: message.mediaType,
        url: message.mediaUrl,
        name: message.mediaName || "file",
      };
    }
    let ok = 0;
    let lastErr = "";
    for (const id of selected) {
      try {
        const res = await fetch(`/api/conversations/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) ok++;
        else lastErr = (await res.json().catch(() => ({}))).error || "Send failed";
      } catch {
        lastErr = "Couldn't reach the server";
      }
    }
    setSending(false);
    if (ok) onDone(ok);
    if (ok < selected.size) {
      setError(`${ok}/${selected.size} sent. ${lastErr}`);
      if (ok) setSelected(new Set());
    } else {
      onClose();
    }
  }

  const preview =
    message.body ||
    (message.mediaType ? `[${message.mediaType}]` : "(empty message)");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-3 dark:border-neutral-700">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold dark:text-neutral-100">
              Forward to…
            </h2>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="mt-1 truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
            ↪ {preview}
          </div>
        </div>

        <div className="border-b border-slate-100 px-5 py-2.5 dark:border-neutral-700/70">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-neutral-500">
              No chats found.
            </p>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                selected.has(c.id)
                  ? "bg-accent/15"
                  : "hover:bg-slate-50 dark:hover:bg-neutral-700/60"
              }`}
            >
              <Avatar
                name={c.contact.name}
                platform={c.platform as Platform}
                size="sm"
                src={c.contact.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium dark:text-neutral-100">
                  {c.contact.name}
                </div>
                <div className="truncate text-xs text-slate-400 dark:text-neutral-500">
                  {PLATFORMS[c.platform as Platform].label}
                </div>
              </div>
              <span
                className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${
                  selected.has(c.id)
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-slate-300 text-transparent dark:border-neutral-600"
                }`}
              >
                ✓
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3 dark:border-neutral-700">
          {error && (
            <span className="flex-1 truncate text-xs text-red-500">{error}</span>
          )}
          {!error && (
            <span className="flex-1 text-xs text-slate-400 dark:text-neutral-500">
              {selected.size} selected
            </span>
          )}
          <button
            onClick={forward}
            disabled={!selected.size || sending}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Forwarding…" : "Forward"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
