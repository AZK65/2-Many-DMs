"use client";

import { useEffect, useState } from "react";
import type { TagDTO } from "@/lib/types";
import type { Platform } from "@/lib/platforms";
import { Avatar } from "./Avatar";

type Member = {
  id: string;
  name: string;
  avatarUrl: string | null;
  tags: TagDTO[];
};

// Group members = the distinct people who've sent messages in the chat. Tagging
// one tags their shared Contact, so the tag shows on their messages.
export function GroupMembers({
  conversationId,
  platform,
  allTags,
}: {
  conversationId: string;
  platform: Platform;
  allTags: TagDTO[];
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}/members`)
      .then((r) => r.json())
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [conversationId]);

  async function addTag(memberId: string, tag: TagDTO) {
    setMembers((ms) =>
      ms.map((m) => (m.id === memberId ? { ...m, tags: [...m.tags, tag] } : m))
    );
    setPickerFor(null);
    await fetch(`/api/contacts/${memberId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: tag.id }),
    }).catch(() => {});
  }
  async function removeTag(memberId: string, tagId: string) {
    setMembers((ms) =>
      ms.map((m) =>
        m.id === memberId ? { ...m, tags: m.tags.filter((t) => t.id !== tagId) } : m
      )
    );
    await fetch(`/api/contacts/${memberId}/tags?tagId=${tagId}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  if (!members.length) {
    return (
      <p className="text-xs text-slate-400 dark:text-neutral-500">
        No members seen yet — they appear here as people message in the group.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {members.map((m) => {
        const avail = allTags.filter((t) => !m.tags.some((x) => x.id === t.id));
        return (
          <div
            key={m.id}
            className="rounded-xl border border-slate-200 p-2.5 dark:border-neutral-700"
          >
            <div className="flex items-center gap-2">
              <Avatar
                name={m.name}
                platform={platform}
                size="sm"
                src={m.avatarUrl || undefined}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium dark:text-neutral-100">
                {m.name}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {m.tags.map((t) => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: t.color }}
                >
                  {t.name}
                  <button
                    onClick={() => removeTag(m.id, t.id)}
                    className="opacity-70 transition hover:opacity-100"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <div className="relative">
                <button
                  onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                  className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:border-slate-400 dark:border-neutral-600 dark:text-neutral-400"
                >
                  + tag
                </button>
                {pickerFor === m.id && (
                  <div className="absolute z-10 mt-1 max-h-44 w-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                    {avail.length === 0 && (
                      <div className="px-2 py-1 text-[11px] text-slate-400">
                        All tags added
                      </div>
                    )}
                    {avail.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => addTag(m.id, t)}
                        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-neutral-700"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                        <span className="truncate dark:text-neutral-200">{t.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
