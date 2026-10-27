"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { PLATFORMS } from "@/lib/platforms";
import { PIPELINE } from "@/lib/pipeline";
import { loadStages } from "@/lib/settings";
import { listTime } from "@/lib/time";

import { Avatar } from "./Avatar";
import { WorkspaceHeader } from "./WorkspaceHeader";
import type { ContactCardDTO, TagDTO } from "@/lib/types";
import { MailIcon } from "./icons";

const NO_STAGE = "none";
const UNTAGGED = "untagged";
type GroupBy = "stage" | "tag" | "email";

function emailAgeHours(card: ContactCardDTO): number {
  return card.emailActivity ? (Date.now() - new Date(card.emailActivity.firstCopiedAt).getTime()) / 3_600_000 : 0;
}

function emailWaitLabel(iso: string): string {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 1) return "Copied less than an hour ago";
  if (hours < 24) return `Waiting ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Waiting ${days}d ${hours % 24}h`;
}

interface Column {
  id: string;
  name: string;
  color: string;
  cards: ContactCardDTO[];
}

export function Board() {
  const [contacts, setContacts] = useState<ContactCardDTO[]>([]);
  const [tags, setTags] = useState<TagDTO[]>([]);

  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>("stage");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const [stages, setStages] = useState(PIPELINE);

  useEffect(() => {
    const requestedGroup = new URLSearchParams(window.location.search).get("group");
    if (["stage", "tag", "email"].includes(requestedGroup || "")) {
      setGroupBy(requestedGroup as GroupBy);
    }
    setStages(loadStages());
    const onChange = () => setStages(loadStages());
    window.addEventListener("tmd-settings", onChange);
    Promise.all([
      fetch("/api/contacts", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
    ]).then(([cs, tg]: [ContactCardDTO[], TagDTO[]]) => {
      setContacts(cs);
      setTags(tg);
    }).catch(() => {
      setContacts([]);
      setTags([]);
    }).finally(() => setLoading(false));
    return () => window.removeEventListener("tmd-settings", onChange);
  }, []);

  useEffect(() => {
    let active = true;
    const loadLiveBoard = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/contacts", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: ContactCardDTO[]) => {
          if (active) setContacts(data);
        })
        .catch(() => {});
    };
    const interval = window.setInterval(loadLiveBoard, 5_000);
    const onVisibilityChange = () => loadLiveBoard();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const columns: Column[] = useMemo(() => {
    if (groupBy === "email") {
      const sorted = (items: ContactCardDTO[]) => [...items].sort((a, b) => emailAgeHours(b) - emailAgeHours(a));
      return [
        { id: "email-new", name: "New · under 24h", color: "#2563eb", cards: sorted(contacts.filter((c) => c.emailActivity && emailAgeHours(c) < 24)) },
        { id: "email-waiting", name: "Waiting · 1–3 days", color: "#d97706", cards: sorted(contacts.filter((c) => c.emailActivity && emailAgeHours(c) >= 24 && emailAgeHours(c) < 72)) },
        { id: "email-old", name: "Old · over 3 days", color: "#dc2626", cards: sorted(contacts.filter((c) => c.emailActivity && emailAgeHours(c) >= 72)) },
      ];
    }
    if (groupBy === "stage") {
      return [{ id: NO_STAGE, name: "No stage", color: "#94a3b8", cards: contacts.filter((c) => !stages.some((s) => s.id === c.stage)) }, ...stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          cards: contacts.filter((c) => c.stage === s.id),
        }))];
    }
    const tagged = tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      cards: contacts.filter((c) => c.tags.some((x) => x.id === t.id)),
    }));
    const untagged = contacts.filter((c) => c.tags.length === 0);
    return [
      { id: UNTAGGED, name: "Untagged", color: "#94a3b8", cards: untagged },
      ...tagged,
    ];
  }, [groupBy, tags, contacts, stages]);

  async function move(contactId: string, targetCol: string) {
    if (groupBy === "email") return;
    if (!dragSource || targetCol === dragSource) return;

    if (groupBy === "stage") {
      const stage = targetCol === NO_STAGE ? null : targetCol;
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, stage } : c))
      );
      await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      }).catch(() => {});
      return;
    }

    // Tag mode: drop the source tag, add the target tag.
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== contactId) return c;
        let next = c.tags;
        if (dragSource !== UNTAGGED) next = next.filter((t) => t.id !== dragSource);
        if (targetCol !== UNTAGGED) {
          const tag = tags.find((t) => t.id === targetCol);
          if (tag && !next.some((t) => t.id === tag.id)) next = [...next, tag];
        }
        return { ...c, tags: next };
      })
    );

    if (targetCol !== UNTAGGED) {
      await fetch(`/api/contacts/${contactId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId: targetCol }),
      }).catch(() => {});
    }
    if (dragSource !== UNTAGGED) {
      await fetch(`/api/contacts/${contactId}/tags?tagId=${dragSource}`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }

  function endDrag() {
    setDragId(null);
    setDragSource(null);
    setOverCol(null);
  }

  return (
    <div className="workspace-page relative flex h-dvh flex-col overflow-hidden bg-slate-50 dark:bg-neutral-900">
      <WorkspaceHeader />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Board</h1>
          <div className="ml-1 flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-neutral-800">
            {(
              [
                ["stage", "Pipeline"],
                ["tag", "Tags"],
                ["email", "Email queue"],
              ] as [GroupBy, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setGroupBy(id)}
                className={`rounded-md px-2.5 py-1 transition ${
                  groupBy === id
                    ? "bg-white text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-400 dark:text-neutral-500">
            {`${contacts.length} contacts · ${groupBy === "email" ? "oldest waits first" : `drag a card to set its ${groupBy === "stage" ? "stage" : "tag"}`}`}
          </div>

        </div>
      </header>

      {/* Board */}
      <div className="scroll-thin flex-1 overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400 dark:text-neutral-500">Loading…</div>
        ) : (
          <div className="flex h-full items-start gap-4 p-4">
            {columns.map((col) => (
              <div
                key={col.id}
                onDragOver={(e) => {
                  if (groupBy === "email") return;
                  e.preventDefault();
                  setOverCol(col.id);
                }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={() => {
                  if (dragId) move(dragId, col.id);
                  endDrag();
                }}
                className={`flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-slate-50 transition dark:bg-neutral-900 ${
                  overCol === col.id
                    ? "border-accent/50 ring-2 ring-accent/50 dark:border-accent dark:ring-accent/40"
                    : "border-slate-200 dark:border-neutral-800"
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-neutral-800">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
                      {col.name}
                    </span>
                  </div>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-neutral-700 dark:text-neutral-300">
                    {col.cards.length}
                  </span>
                </div>

                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-2">
                  {col.cards.length === 0 && (
                    <div className="py-8 text-center text-xs text-slate-400 dark:text-neutral-500">
                      Drop deals here
                    </div>
                  )}
                  {col.cards.map((card) => {
                    const platform = PLATFORMS[card.platform];
                    return (
                      <motion.div
                        key={card.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        draggable={groupBy !== "email"}
                        onDragStart={() => {
                          setDragId(card.id);
                          setDragSource(col.id);
                        }}
                        onDragEnd={endDrag}
                        className={`cursor-grab rounded-xl border border-slate-200 bg-white p-3 transition-colors duration-200 active:cursor-grabbing dark:border-neutral-700 dark:bg-[#1F1F1F] ${
                          dragId === card.id ? "opacity-50" : "hover:shadow-md"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {card.conversationId ? (
                            <Link href={`/?c=${card.conversationId}`} title={`Open conversation with ${card.name}`} className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                              <Avatar name={card.name} platform={card.platform} size="sm" src={card.avatarUrl} />
                            </Link>
                          ) : <Avatar name={card.name} platform={card.platform} size="sm" src={card.avatarUrl} />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium text-slate-900 dark:text-neutral-100">
                                {card.name}
                              </span>
                              {card.lastMessageAt && (
                                <span className="shrink-0 text-[10px] text-slate-400 dark:text-neutral-500">
                                  {listTime(card.lastMessageAt)}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-slate-500 dark:text-neutral-400">
                              {card.lastMessage || card.handle}
                            </div>

                          </div>
                        </div>
                        {card.tags.length > 1 && (
                          <div className="mt-1.5 flex flex-wrap gap-1 pl-[42px]">
                            {card.tags
                              .filter((t) => t.id !== col.id)
                              .map((t) => (
                                <span
                                  key={t.id}
                                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                  style={{
                                    color: t.color,
                                    backgroundColor: `${t.color}1a`,
                                  }}
                                >
                                  {t.name}
                                </span>
                              ))}
                          </div>
                        )}
                        {card.emailActivity && (
                          <div className="mt-2 ml-[42px] rounded-md bg-slate-100 px-2 py-1.5 dark:bg-neutral-700/70">
                            <div className="truncate text-[11px] font-medium text-slate-700 dark:text-neutral-200">{card.emailActivity.email}</div>
                            <div className={`mt-0.5 text-[10px] font-semibold ${emailAgeHours(card) >= 72 ? "text-red-600 dark:text-red-400" : emailAgeHours(card) >= 24 ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}`}>
                              {emailWaitLabel(card.emailActivity.firstCopiedAt)}
                            </div>
                          </div>
                        )}

                        <div className="mt-1 flex items-center gap-1 pl-[42px] text-[10px] text-slate-400 dark:text-neutral-500">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: platform.bg }}
                          />
                          {platform.label}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
