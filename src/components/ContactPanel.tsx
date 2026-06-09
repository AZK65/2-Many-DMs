"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ConversationDTO, TagDTO } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms";
import { Avatar } from "./Avatar";

export function ContactPanel({
  conversation,
  allTags,
  onTagsChanged,
  onTagCreated,
}: {
  conversation: ConversationDTO;
  allTags: TagDTO[];
  onTagsChanged: (contactId: string, tags: TagDTO[]) => void;
  onTagCreated: (tag: TagDTO) => void;
}) {
  const contact = conversation.contact;
  const [picker, setPicker] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  const assigned = new Set(contact.tags.map((t) => t.id));
  const available = allTags.filter((t) => !assigned.has(t.id));
  const platform = PLATFORMS[conversation.platform];

  async function addTag(tag: TagDTO) {
    await fetch(`/api/contacts/${contact.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: tag.id }),
    });
    onTagsChanged(contact.id, [...contact.tags, tag]);
    setPicker(false);
  }

  async function removeTag(tagId: string) {
    await fetch(`/api/contacts/${contact.id}/tags?tagId=${tagId}`, {
      method: "DELETE",
    });
    onTagsChanged(
      contact.id,
      contact.tags.filter((t) => t.id !== tagId)
    );
  }

  async function createTag() {
    const name = newTag.trim();
    if (!name) return;
    const res = await fetch(`/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const tag: TagDTO = await res.json();
    onTagCreated(tag);
    setNewTag("");
    await addTag(tag);
  }

  async function saveNotes() {
    setSavingNotes(true);
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setSavingNotes(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="scroll-thin flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white"
    >
      <div className="flex flex-col items-center gap-3 border-b border-slate-100 px-6 py-7 text-center">
        <Avatar
          name={contact.name}
          platform={conversation.platform}
          size="lg"
          src={contact.avatarUrl}
        />
        <div>
          <div className="text-lg font-semibold">{contact.name}</div>
          <div className="text-sm text-slate-500">{contact.handle}</div>
        </div>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: platform.bg }}
        >
          {platform.label}
        </span>
      </div>

      <Section title="Company">
        <div className="text-sm text-slate-700">
          {contact.company || <span className="text-slate-400">—</span>}
        </div>
      </Section>

      <Section
        title="Tags"
        action={
          <button
            onClick={() => setPicker((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {picker ? "Done" : "+ Add"}
          </button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {contact.tags.length === 0 && !picker && (
            <span className="text-sm text-slate-400">No tags yet</span>
          )}
          <AnimatePresence mode="popLayout">
            {contact.tags.map((t) => (
              <motion.span
                key={t.id}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white"
                style={{ backgroundColor: t.color }}
              >
                {t.name}
                <button
                  onClick={() => removeTag(t.id)}
                  className="opacity-70 hover:opacity-100"
                  aria-label={`Remove ${t.name}`}
                >
                  ×
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        {picker && (
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-2">
            <div className="flex flex-wrap gap-1.5">
              {available.length === 0 && (
                <span className="text-xs text-slate-400">All tags applied</span>
              )}
              {available.map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTag(t)}
                  className="rounded-full border px-2.5 py-1 text-xs font-medium transition hover:text-white"
                  style={{ borderColor: t.color, color: t.color }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = t.color)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 pt-1">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTag()}
                placeholder="New tag…"
                className="min-w-0 flex-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200"
              />
              <button
                onClick={createTag}
                className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={5}
          placeholder="Add private notes about this contact…"
          className="w-full resize-none rounded-lg bg-slate-100 p-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200"
        />
        <div className="h-4 text-right text-[10px] text-slate-400">
          {savingNotes ? "Saving…" : "Saved on blur"}
        </div>
      </Section>
    </motion.div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
