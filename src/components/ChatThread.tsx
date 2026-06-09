"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { MEDIA_LABEL, type ConversationDTO, type MessageDTO } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms";
import { clockTime, dayLabel, sameDay } from "@/lib/time";
import { Avatar } from "./Avatar";
import { SendIcon } from "./icons";

export function ChatThread({
  conversation,
  onSent,
}: {
  conversation: ConversationDTO;
  onSent: (preview: string) => void;
}) {
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const msg: MessageDTO = await res.json();
    setMessages((m) => [...m, msg]);
    onSent(body);
    setSending(false);
  }

  const platform = PLATFORMS[conversation.platform];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col bg-slate-50"
    >
      {/* Header — identical layout for every platform, only the badge differs */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
        <Avatar
          name={conversation.contact.name}
          platform={conversation.platform}
          size="sm"
          src={conversation.contact.avatarUrl}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            {conversation.contact.name}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: platform.bg }}
            />
            {platform.label} · {conversation.contact.handle}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="scroll-thin flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="pt-10 text-center text-sm text-slate-400">Loading…</div>
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
                    <span className="rounded-full bg-slate-200/80 px-3 py-0.5 text-[11px] font-medium text-slate-500">
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
                        ? "rounded-br-md bg-blue-600 text-white"
                        : "rounded-bl-md bg-white text-slate-800"
                    }`}
                  >
                    <MediaContent message={m} />
                    {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                    <div
                      className={`mt-0.5 text-right text-[10px] ${
                        m.direction === "out" ? "text-blue-100" : "text-slate-400"
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
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`Message on ${platform.label}…`}
            className="max-h-32 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200"
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={send}
            disabled={!draft.trim() || sending}
            title="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-40"
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
