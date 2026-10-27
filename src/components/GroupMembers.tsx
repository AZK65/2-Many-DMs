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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setMembers([]);
    setPickerFor(null);
    setLoading(true);
    setError(false);
    fetch(`/api/conversations/${conversationId}/members`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error("Could not load people"); return r.json(); })
      .then(data => { if (!controller.signal.aborted) setMembers(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, retry]);

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

  if (loading) return <div role="status" aria-label="Loading people in this group" className="space-y-3">
    {[0, 1, 2].map(i => <div key={i} className="flex animate-pulse items-center gap-2 motion-reduce:animate-none">
      <span className="h-10 w-10 rounded-full bg-slate-200 dark:bg-neutral-800" />
      <span className="h-4 w-24 rounded bg-slate-200 dark:bg-neutral-800" />
    </div>)}
  </div>;

  if (error) return <div className="text-xs text-slate-500 dark:text-neutral-400">
    Could not load people in this group.
    <button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 rounded text-accent underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">Retry</button>
  </div>;

  if (!members.length) {
    return (
      <p className="text-xs text-slate-400 dark:text-neutral-500">
        No members seen yet — they appear here as people message in the group.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="pb-2 text-xs text-slate-500 dark:text-neutral-400">
        {members.length} {members.length === 1 ? "person" : "people"} from synced messages. This may not include everyone currently in the group.
      </p>
      {members.map((m) => {
        const avail = allTags.filter((t) => !m.tags.some((x) => x.id === t.id));
        return (
          <div
            key={m.id}
            className="group py-2"
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
            <div className="ml-12 flex flex-wrap items-center gap-1">
              {m.tags.map((t) => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: t.color }}
                >
                  {t.name}
                  <button
                    onClick={() => removeTag(m.id, t.id)}
                    aria-label={`Remove ${t.name} from ${m.name}`}
                    className="opacity-70 transition hover:opacity-100"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <div className="relative">
                <button
                  onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                  aria-label={`Add a tag to ${m.name}`}
                  aria-expanded={pickerFor === m.id}
                  className="rounded px-1 py-0.5 text-xs text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
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
