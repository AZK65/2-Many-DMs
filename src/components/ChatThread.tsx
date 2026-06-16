"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  MEDIA_LABEL,
  type ConversationDTO,
  type MessageDTO,
  type SnippetDTO,
} from "@/lib/types";
import {
  PLATFORMS,
  PLATFORM_ATTACHMENTS,
  mimeToMediaType,
} from "@/lib/platforms";
import { clockTime, dayLabel, sameDay } from "@/lib/time";
import { Avatar } from "./Avatar";
import { EmojiPicker } from "./EmojiPicker";
import {
  PaperclipIcon,
  SendIcon,
  SmileyIcon,
  ZapIcon,
} from "./icons";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function ChatThread({
  conversation,
  snippets,
  onManageSnippets,
  onSent,
}: {
  conversation: ConversationDTO;
  snippets: SnippetDTO[];
  onManageSnippets: () => void;
  onSent: (preview: string) => void;
}) {
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const caps = PLATFORM_ATTACHMENTS[conversation.platform];

  // "/" slash menu: open when the draft is a lone "/token" (no spaces).
  const slashMatch = /^\/(\S*)$/.exec(draft);
  const slashOpen = slashMatch !== null;
  const slashQuery = slashMatch?.[1].toLowerCase() ?? "";
  const slashResults = useMemo(
    () =>
      slashOpen
        ? snippets.filter(
            (s) =>
              s.title.toLowerCase().includes(slashQuery) ||
              s.text.toLowerCase().includes(slashQuery)
          )
        : [],
    [slashOpen, slashQuery, snippets]
  );
  const [slashIndex, setSlashIndex] = useState(0);
  useEffect(() => setSlashIndex(0), [slashQuery, slashOpen]);

  // Insert text at the cursor (or replace the whole draft for slash snippets).
  function insertText(text: string, replaceAll = false) {
    const ta = textareaRef.current;
    if (!ta || replaceAll) {
      setDraft(text);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(text.length, text.length);
      });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setDraft(draft.slice(0, start) + text + draft.slice(end));
    requestAnimationFrame(() => {
      const pos = start + text.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function insertSnippet(s: SnippetDTO, replaceAll = false) {
    insertText(s.text, replaceAll);
  }

  function pickFile(file: File | null) {
    setAttachError(null);
    if (!file) return;
    const type = mimeToMediaType(file.type);
    if (!caps.types.includes(type)) {
      setAttachError(
        `${PLATFORMS[conversation.platform].label} can't send this file type. ${caps.hint}.`
      );
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setAttachError("File is over the 25 MB limit.");
      return;
    }
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    setAttachment(file);
    setAttachmentUrl(URL.createObjectURL(file));
  }

  function clearAttachment() {
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    setAttachment(null);
    setAttachmentUrl(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    let active = true;
    setLoading(true);

    const load = () =>
      fetch(`/api/conversations/${conversation.id}/messages`)
        .then((r) => r.json())
        .then((data: MessageDTO[]) => {
          if (active) {
            setMessages(data);
            setLoading(false);
          }
        })
        .catch(() => {});

    load();
    // Poll the open thread so newly synced inbound messages stream in.
    const t = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [conversation.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if ((!body && !attachment) || sending) return;
    setSending(true);

    let res: Response;
    if (attachment) {
      const form = new FormData();
      form.append("file", attachment);
      form.append("body", body);
      res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        body: form,
      });
    } else {
      res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setAttachError(err.error || "Couldn't send message.");
      setSending(false);
      return;
    }

    const msg: MessageDTO = await res.json();
    setMessages((m) => [...m, msg]);
    onSent(body || (msg.mediaType ? MEDIA_LABEL[msg.mediaType] : ""));
    setDraft("");
    clearAttachment();
    setSending(false);
  }

  const platform = PLATFORMS[conversation.platform];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col bg-slate-50 dark:bg-neutral-950"
    >
      {/* Header — identical layout for every platform, only the badge differs */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5 dark:border-neutral-800 dark:bg-neutral-900">
        <Avatar
          name={conversation.contact.name}
          platform={conversation.platform}
          size="sm"
          src={conversation.contact.avatarUrl}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">
            {conversation.contact.name}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-neutral-500">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: platform.bg }}
            />
            {platform.label} · {conversation.contact.handle}
            {conversation.account?.label && (
              <span
                title="The account you're messaging from"
                className="ml-1 max-w-[12rem] truncate rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent dark:text-accent"
              >
                via {conversation.account.label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="scroll-thin flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="pt-10 text-center text-sm text-slate-400 dark:text-neutral-500">Loading…</div>
        ) : (
          messages.map((m, idx) => {
            const showDate =
              idx === 0 || !sameDay(messages[idx - 1].createdAt, m.createdAt);
            return (
              <Fragment key={m.id}>
                {showDate && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="my-3 flex justify-center"
                  >
                    <span className="rounded-full bg-slate-200/80 px-3 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                      {dayLabel(m.createdAt)}
                    </span>
                  </motion.div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                      m.direction === "out"
                        ? "rounded-br-md bg-accent text-accent-fg"
                        : "rounded-bl-md bg-white text-slate-800 dark:bg-neutral-800 dark:text-neutral-100"
                    }`}
                  >
                    <MediaContent message={m} />
                    {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                    <div
                      className={`mt-0.5 text-right text-[10px] ${
                        m.direction === "out"
                          ? "text-[#0c3a25]"
                          : "text-slate-400 dark:text-neutral-500"
                      }`}
                    >
                      {clockTime(m.createdAt)}
                    </div>
                  </div>
                </motion.div>
              </Fragment>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="relative border-t border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        {/* "/" snippet menu */}
        <AnimatePresence>
          {slashOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="absolute bottom-full left-4 right-4 mb-2 max-h-72 origin-bottom overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-neutral-700">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                  <ZapIcon className="h-3.5 w-3.5" />
                  Snippets
                </span>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onManageSnippets();
                  }}
                  className="text-[11px] font-medium text-accent hover:underline dark:text-accent"
                >
                  Manage
                </button>
              </div>
              <div className="scroll-thin max-h-56 overflow-y-auto p-1">
                {slashResults.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-neutral-500">
                    {snippets.length === 0
                      ? "No snippets yet — click Manage to add one."
                      : "No match."}
                  </div>
                )}
                {slashResults.map((s, i) => (
                  <button
                    key={s.id}
                    onMouseEnter={() => setSlashIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertSnippet(s, true);
                    }}
                    className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                      i === slashIndex
                        ? "bg-accent/15 dark:bg-accent/15"
                        : "hover:bg-slate-100 dark:hover:bg-neutral-700/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800 dark:text-neutral-100">
                        {s.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500 dark:text-neutral-400">
                        {s.text}
                      </span>
                    </span>
                    {s.shortcut && (
                      <kbd className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-neutral-700 dark:text-neutral-300">
                        {IS_MAC ? "⌘" : "Ctrl"}
                        {s.shortcut.toUpperCase()}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attachment preview / error */}
        <AnimatePresence>
          {attachment && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="mb-2 flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {mimeToMediaType(attachment.type) === "image" && attachmentUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachmentUrl}
                  alt=""
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded-lg bg-slate-200 text-slate-500 dark:bg-neutral-700 dark:text-neutral-400">
                  <PaperclipIcon className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-700 dark:text-neutral-200">
                  {attachment.name}
                </div>
                <div className="text-xs text-slate-400 dark:text-neutral-500">
                  {(attachment.size / 1024).toFixed(0)} KB ·{" "}
                  {mimeToMediaType(attachment.type)}
                </div>
              </div>
              <button
                onClick={clearAttachment}
                aria-label="Remove attachment"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
              >
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {attachError && (
          <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:bg-red-500/15 dark:text-red-400">
            {attachError}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={caps.accept}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex items-end gap-2">
          <div className="relative">
            <button
              onClick={() => setShowEmoji((v) => !v)}
              title="Emoji"
              className={`mb-px flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
                showEmoji
                  ? "bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              }`}
            >
              <SmileyIcon className="h-[18px] w-[18px]" />
            </button>
            <AnimatePresence>
              {showEmoji && (
                <EmojiPicker
                  onPick={(e) => insertText(e)}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            title={`Attach — ${caps.hint}`}
            className="mb-px flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <PaperclipIcon className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={onManageSnippets}
            title="Snippets"
            className="mb-px flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <ZapIcon className="h-[18px] w-[18px]" />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl + <key> inserts the matching snippet.
              if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.length === 1) {
                const s = snippets.find(
                  (x) => x.shortcut && x.shortcut === e.key.toLowerCase()
                );
                if (s) {
                  e.preventDefault();
                  insertSnippet(s);
                  return;
                }
              }
              // Slash-menu navigation takes over Enter/Arrows.
              if (slashOpen && slashResults.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashResults.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex(
                    (i) => (i - 1 + slashResults.length) % slashResults.length
                  );
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  insertSnippet(slashResults[slashIndex], true);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft("");
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`Message on ${platform.label}…  ( / for snippets )`}
            className="max-h-32 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-accent/40 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus:ring-accent/40"
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={send}
            disabled={(!draft.trim() && !attachment) || sending}
            title="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:bg-accent disabled:opacity-40"
          >
            <SendIcon className="h-[18px] w-[18px]" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function MediaContent({ message }: { message: MessageDTO }) {
  const { mediaType, mediaUrl, mediaName } = message;
  if (!mediaType) return null;

  // Media that couldn't be downloaded (over size cap, or animated sticker).
  if (!mediaUrl) {
    return (
      <div className="mb-1 rounded-lg bg-black/5 px-2.5 py-1.5 text-xs opacity-80">
        {mediaName || MEDIA_LABEL[mediaType]}
      </div>
    );
  }

  const wrap = "mb-1 overflow-hidden rounded-lg";
  switch (mediaType) {
    case "image":
      return (
        <a href={mediaUrl} target="_blank" rel="noreferrer" className={`block ${wrap}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl} alt="" className="max-h-72 w-auto rounded-lg" />
        </a>
      );
    case "sticker":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl} alt="sticker" className="mb-1 h-28 w-28 object-contain" />
      );
    case "video":
      return (
        <video src={mediaUrl} controls className={`max-h-72 ${wrap}`} />
      );
    case "audio":
      return <audio src={mediaUrl} controls className="mb-1 w-56 max-w-full" />;
    case "file":
      return (
        <a
          href={mediaUrl}
          download={mediaName || true}
          className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs hover:bg-black/10"
        >
          <span>📎</span>
          <span className="truncate">{mediaName || "Download file"}</span>
        </a>
      );
  }
}
