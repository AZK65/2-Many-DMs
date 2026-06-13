"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type {
  ConversationDTO,
  ContactDTO,
  RelationDTO,
  TagDTO,
} from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms";
import { Avatar } from "./Avatar";
import {
  BuildingIcon,
  MailIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  UserIcon,
} from "./icons";

type EditableField = "name" | "company" | "email" | "phone";

export function ContactPanel({
  conversation,
  allTags,
  conversations,
  onSelectConversation,
  onContactChanged,
  onTagsChanged,
  onTagCreated,
}: {
  conversation: ConversationDTO;
  allTags: TagDTO[];
  conversations: ConversationDTO[];
  onSelectConversation: (conversationId: string) => void;
  onContactChanged: (contactId: string, patch: Partial<ContactDTO>) => void;
  onTagsChanged: (contactId: string, tags: TagDTO[]) => void;
  onTagCreated: (tag: TagDTO) => void;
}) {
  const contact = conversation.contact;
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [relations, setRelations] = useState<RelationDTO[]>([]);
  const [relPicker, setRelPicker] = useState(false);
  const [relQuery, setRelQuery] = useState("");

  // Local editable copy so typing is smooth; we persist on blur.
  const [fields, setFields] = useState({
    name: contact.name ?? "",
    company: contact.company ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
  });
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  // Re-seed local fields when the selected contact changes.
  useEffect(() => {
    setFields({
      name: contact.name ?? "",
      company: contact.company ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    });
    setNotes(contact.notes ?? "");
    setEditing(false);
    setRelPicker(false);
    setRelQuery("");
    fetch(`/api/contacts/${contact.id}/relations`)
      .then((r) => r.json())
      .then((rels: RelationDTO[]) => setRelations(rels))
      .catch(() => setRelations([]));
  }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const assigned = new Set(contact.tags.map((t) => t.id));
  const available = allTags.filter((t) => !assigned.has(t.id));
  const platform = PLATFORMS[conversation.platform];

  // Conversations available to relate: everything except this chat and ones
  // already linked, filtered by the picker search.
  const relatedIds = new Set(relations.map((r) => r.conversationId));
  const relatableConvs = conversations.filter((c) => {
    if (c.id === conversation.id || relatedIds.has(c.id)) return false;
    if (!relQuery) return true;
    const q = relQuery.toLowerCase();
    return (
      c.contact.name.toLowerCase().includes(q) ||
      c.contact.handle.toLowerCase().includes(q)
    );
  });

  async function addRelation(target: ConversationDTO) {
    setRelQuery("");
    setRelPicker(false);
    const res = await fetch(`/api/contacts/${contact.id}/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetConversationId: target.id }),
    });
    const rel: RelationDTO = await res.json();
    setRelations((rs) =>
      rs.some((r) => r.id === rel.id) ? rs : [...rs, rel]
    );
  }

  async function removeRelation(id: string) {
    setRelations((rs) => rs.filter((r) => r.id !== id));
    await fetch(`/api/contacts/${contact.id}/relations?id=${id}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  async function saveRelationLabel(id: string, label: string) {
    setRelations((rs) =>
      rs.map((r) => (r.id === id ? { ...r, label: label || null } : r))
    );
    await fetch(`/api/contacts/${contact.id}/relations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label }),
    }).catch(() => {});
  }

  async function saveField(field: EditableField) {
    const value = fields[field].trim();
    const current = (contact[field] ?? "") as string;
    if (value === current) return;
    if (field === "name" && !value) {
      setFields((f) => ({ ...f, name: contact.name }));
      return;
    }
    onContactChanged(contact.id, { [field]: value || null });
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {});
  }

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
    if (notes === (contact.notes ?? "")) return;
    setSavingNotes(true);
    onContactChanged(contact.id, { notes });
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setSavingNotes(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="scroll-thin flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-col items-center gap-3 border-b border-slate-100 px-6 pb-7 pt-12 text-center dark:border-neutral-800">
        <Avatar
          name={contact.name}
          platform={conversation.platform}
          size="lg"
          src={contact.avatarUrl}
        />
        <div>
          <div className="text-lg font-semibold dark:text-neutral-100">
            {fields.name || contact.name}
          </div>
          <div className="text-sm text-slate-500 dark:text-neutral-400">
            {contact.handle}
          </div>
        </div>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: platform.bg }}
        >
          {platform.label}
        </span>
      </div>

      <Section
        title="Details"
        action={
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {editing ? "Done" : "Edit"}
          </button>
        }
      >
        <div className="space-y-2.5">
          <Field
            icon={<UserIcon className="h-4 w-4" />}
            label="Full name"
            value={fields.name}
            placeholder="Add full name"
            editing={editing}
            onChange={(v) => setFields((f) => ({ ...f, name: v }))}
            onBlur={() => saveField("name")}
          />
          <Field
            icon={<BuildingIcon className="h-4 w-4" />}
            label="Company"
            value={fields.company}
            placeholder="Add company"
            editing={editing}
            onChange={(v) => setFields((f) => ({ ...f, company: v }))}
            onBlur={() => saveField("company")}
          />
          <Field
            icon={<MailIcon className="h-4 w-4" />}
            label="Email"
            type="email"
            value={fields.email}
            placeholder="Add email"
            editing={editing}
            onChange={(v) => setFields((f) => ({ ...f, email: v }))}
            onBlur={() => saveField("email")}
          />
          <Field
            icon={<PhoneIcon className="h-4 w-4" />}
            label="Phone"
            type="tel"
            value={fields.phone}
            placeholder="Add phone number"
            editing={editing}
            onChange={(v) => setFields((f) => ({ ...f, phone: v }))}
            onBlur={() => saveField("phone")}
          />
        </div>
      </Section>

      <Section
        title="Tags"
        action={
          <button
            onClick={() => setPicker((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {picker ? "Done" : "+ Add"}
          </button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {contact.tags.length === 0 && !picker && (
            <span className="text-sm text-slate-400 dark:text-neutral-500">
              No tags yet
            </span>
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
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-neutral-700">
            <div className="flex flex-wrap gap-1.5">
              {available.length === 0 && (
                <span className="text-xs text-slate-400 dark:text-neutral-500">
                  All tags applied
                </span>
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
                className="min-w-0 flex-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-blue-500/40"
              />
              <button
                onClick={createTag}
                className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
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
          className="w-full resize-none rounded-lg bg-slate-100 p-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus:ring-blue-500/40"
        />
        <div className="h-4 text-right text-[10px] text-slate-400 dark:text-neutral-500">
          {savingNotes ? "Saving…" : "Saved on blur"}
        </div>
      </Section>

      <Section
        title="Relations"
        action={
          <button
            onClick={() => {
              setRelPicker((v) => !v);
              setRelQuery("");
            }}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {relPicker ? "Done" : "+ Add"}
          </button>
        }
      >
        {relations.length === 0 && !relPicker && (
          <span className="text-sm text-slate-400 dark:text-neutral-500">
            No linked chats yet
          </span>
        )}

        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {relations.map((r) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="group flex items-center gap-2.5 rounded-lg border border-slate-200 p-2 transition hover:border-slate-300 dark:border-neutral-800 dark:hover:border-neutral-700"
              >
                <button
                  onClick={() => onSelectConversation(r.conversationId)}
                  title="Open this chat"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Avatar
                    name={r.contactName}
                    platform={r.platform}
                    size="sm"
                    src={r.avatarUrl}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-neutral-100">
                      {r.contactName}
                    </span>
                    <input
                      value={r.label ?? ""}
                      onChange={(e) =>
                        setRelations((rs) =>
                          rs.map((x) =>
                            x.id === r.id
                              ? { ...x, label: e.target.value }
                              : x
                          )
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => saveRelationLabel(r.id, e.target.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      placeholder="Add label (e.g. works with)"
                      className="mt-0.5 w-full bg-transparent text-xs text-slate-500 outline-none placeholder:text-slate-400 dark:text-neutral-400 dark:placeholder:text-neutral-600"
                    />
                  </span>
                </button>
                <button
                  onClick={() => removeRelation(r.id)}
                  aria-label="Remove relation"
                  className="shrink-0 rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                >
                  ×
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {relPicker && (
          <div className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-neutral-700">
            <div className="relative mb-2">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-neutral-500" />
              <input
                autoFocus
                value={relQuery}
                onChange={(e) => setRelQuery(e.target.value)}
                placeholder="Search chats to link…"
                className="w-full rounded-md bg-slate-100 py-1.5 pl-8 pr-2.5 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-blue-500/40"
              />
            </div>
            <div className="scroll-thin max-h-56 space-y-0.5 overflow-y-auto">
              {relatableConvs.length === 0 && (
                <div className="px-1 py-2 text-center text-xs text-slate-400 dark:text-neutral-500">
                  No matching chats
                </div>
              )}
              {relatableConvs.slice(0, 30).map((c) => (
                <button
                  key={c.id}
                  onClick={() => addRelation(c)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-neutral-800"
                >
                  <Avatar
                    name={c.contact.name}
                    platform={c.platform}
                    size="sm"
                    src={c.contact.avatarUrl}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800 dark:text-neutral-100">
                      {c.contact.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400 dark:text-neutral-500">
                      {c.contact.handle}
                    </span>
                  </span>
                  <PlusIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-neutral-500" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>
    </motion.div>
  );
}

function Field({
  icon,
  label,
  value,
  placeholder,
  type = "text",
  editing,
  onChange,
  onBlur,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  editing: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">
          {label}
        </span>
        {editing ? (
          <input
            autoFocus={label === "Full name"}
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-blue-500/50 dark:focus:ring-blue-500/20"
          />
        ) : (
          <span
            className={`block truncate text-sm ${
              value
                ? "text-slate-800 dark:text-neutral-100"
                : "text-slate-400 dark:text-neutral-600"
            }`}
          >
            {value || placeholder}
          </span>
        )}
      </span>
    </label>
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
    <div className="border-b border-slate-100 px-6 py-4 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
