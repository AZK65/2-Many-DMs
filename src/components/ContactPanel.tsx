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

import { GroupMembers } from "./GroupMembers";

import {
  MESSAGE_PIN_CHANGED_EVENT,
  type SharedContentDTO,
  type SharedMessageDTO,
} from "@/lib/shared-content";
import {
  BuildingIcon,
  CloseIcon,
  LinkIcon,
  MailIcon,
  PaperclipIcon,
  PinIcon,
  PhoneIcon,
  PlusIcon,
  RefreshIcon,
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
  onIntentChanged,
  onFocusMessage,
  onClose,
  readOnly = false,
}: {
  conversation: ConversationDTO;
  allTags: TagDTO[];
  conversations: ConversationDTO[];
  onSelectConversation: (conversationId: string) => void;
  onContactChanged: (contactId: string, patch: Partial<ContactDTO>) => void;
  onTagsChanged: (contactId: string, tags: TagDTO[]) => void;
  onTagCreated: (tag: TagDTO) => void;
  onIntentChanged: (intent: ConversationDTO["intent"]) => void;
  onFocusMessage: (messageId: string) => void;
  onClose?: () => void;
  readOnly?: boolean;
}) {
  const contact = conversation.contact;
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [relations, setRelations] = useState<RelationDTO[]>([]);
  const [relPicker, setRelPicker] = useState(false);
  const [relQuery, setRelQuery] = useState("");

  const [sharedContent, setSharedContent] = useState<SharedContentDTO>({
    pinned: [],
    media: [],
    links: [],
  });
  const [sharedView, setSharedView] = useState<"pinned" | "media" | "links">("pinned");
  const [panelTab, setPanelTab] = useState<"info" | "shared">("info");
  const [sharedLoading, setSharedLoading] = useState(true);
  const [sharedError, setSharedError] = useState<string | null>(null);

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

  async function loadSharedContent(showLoading = false) {
    if (showLoading) setSharedLoading(true);
    setSharedError(null);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/shared`);
      const data = (await response.json().catch(() => ({}))) as SharedContentDTO & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Shared items could not be loaded.");
      setSharedContent(data);
    } catch (error) {
      setSharedError(
        error instanceof Error ? error.message : "Shared items could not be loaded."
      );
    } finally {
      setSharedLoading(false);
    }
  }

  useEffect(() => {
    setSharedView("pinned");
    setSharedContent({ pinned: [], media: [], links: [] });
    void loadSharedContent(true);

    const receivePinUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId === conversation.id) void loadSharedContent();
    };
    window.addEventListener(MESSAGE_PIN_CHANGED_EVENT, receivePinUpdate);
    return () => window.removeEventListener(MESSAGE_PIN_CHANGED_EVENT, receivePinUpdate);
  }, [conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const rawValue = fields[field].trim();
    const value = rawValue;
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
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="contact-inspector scroll-thin fixed inset-y-0 right-0 z-40 flex h-full w-full max-w-sm shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-slate-50 shadow-xl lg:static lg:z-auto lg:w-80 lg:shadow-none dark:border-neutral-800 dark:bg-[#1F1F1F]"
    >
      <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-50 px-4 pr-14 dark:border-neutral-800 dark:bg-[#1F1F1F]">
        {([['info', 'Info'], ['shared', 'Shared']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={panelTab === id} onClick={() => setPanelTab(id)} className={`rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ${panelTab === id ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-800 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white"}`}>{label}</button>)}
      {onClose && (
        <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Close contact details">
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
      </div>
      <div hidden={panelTab !== "shared"}>
        <SharedInChat content={sharedContent} view={sharedView} loading={sharedLoading} error={sharedError} onViewChange={setSharedView} onRefresh={() => void loadSharedContent(true)} onOpenMessage={onFocusMessage} />
      </div>
      <div hidden={panelTab !== "info"}>
      <div className="flex flex-col items-center gap-3 border-b border-slate-200 px-6 py-6 text-center dark:border-neutral-800">
        <Avatar
          name={contact.name}
          platform={conversation.platform}
          size="lg"
          src={contact.avatarUrl}
          group={conversation.groupPreview}
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
          className="rounded px-2 py-1 text-xs font-medium text-slate-500 dark:text-neutral-400"
        >
          {platform.label}
        </span>
      </div>

      {conversation.isGroup && (
        <Section title="People seen in this group">
          <GroupMembers
            conversationId={conversation.id}
            platform={conversation.platform}
            allTags={allTags}
          />
        </Section>
      )}

      <Section
        title="User information"
        action={
          readOnly ? undefined : <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="text-xs font-medium text-accent transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-accent/80 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {editing ? "Done" : "Edit"}
          </button>
        }
      >
        <div className="space-y-4">
          <Field
            icon={<UserIcon className="h-4 w-4" />}
            label="Full name"
            value={fields.name}
            placeholder="Add full name"
            editing={editing}
            onChange={(value) => setFields((current) => ({ ...current, name: value }))}
            onBlur={() => saveField("name")}
          />
          <Field
            icon={<MailIcon className="h-4 w-4" />}
            label="Email"
            type="email"
            value={fields.email}
            placeholder="Add email"
            editing={editing}
            onChange={(value) => setFields((current) => ({ ...current, email: value }))}
            onBlur={() => saveField("email")}
          />
          <Field
            icon={<PhoneIcon className="h-4 w-4" />}
            label="Phone"
            type="tel"
            value={fields.phone}
            placeholder="Add phone number"
            editing={editing}
            onChange={(value) => setFields((current) => ({ ...current, phone: value }))}
            onBlur={() => saveField("phone")}
          />
          <Field
            icon={<BuildingIcon className="h-4 w-4" />}
            label="Company"
            value={fields.company}
            placeholder="Add company"
            editing={editing}
            onChange={(value) => setFields((current) => ({ ...current, company: value }))}
            onBlur={() => saveField("company")}
          />

        </div>
      </Section>

      <Section title="Conversation type">
        <select
          disabled={readOnly}
          value={conversation.intent}
          onChange={(e) => {
            const intent = e.target.value as ConversationDTO["intent"];
            onIntentChanged(intent);
            fetch(`/api/conversations/${conversation.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intent }),
            }).catch(() => {});
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="prospect">Prospect</option>
          <option value="onboarding">Onboarding</option>
          <option value="support">Support</option>
          <option value="normal">Normal / personal</option>
        </select>
      </Section>

      <Section
        title="Tags"
        action={
          readOnly ? undefined : <button
            onClick={() => setPicker((v) => !v)}
            className="text-xs font-medium text-accent hover:text-accent dark:text-accent dark:hover:text-accent"
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
                {!readOnly && <button
                  onClick={() => removeTag(t.id)}
                  className="opacity-70 hover:opacity-100"
                  aria-label={`Remove ${t.name}`}
                >
                  ×
                </button>}
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
                className="min-w-0 flex-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-accent/40 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-accent/40"
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
          readOnly={readOnly}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => !readOnly && saveNotes()}
          rows={5}
          placeholder="Add private notes about this contact…"
          className="w-full resize-none rounded-lg bg-slate-100 p-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-accent/40 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus:ring-accent/40"
        />
        <div className="h-4 text-right text-[10px] text-slate-400 dark:text-neutral-500">
          {readOnly ? "Read only" : savingNotes ? "Saving…" : "Saved on blur"}
        </div>
      </Section>

      <Section
        title="Relations"
        action={
          readOnly ? undefined : <button
            onClick={() => {
              setRelPicker((v) => !v);
              setRelQuery("");
            }}
            className="text-xs font-medium text-accent hover:text-accent dark:text-accent dark:hover:text-accent"
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
                className="w-full rounded-md bg-slate-100 py-1.5 pl-8 pr-2.5 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-accent/40 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-accent/40"
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
      </div>
    </motion.div>
  );
}

function sharedSender(item: { direction: "in" | "out"; senderName: string | null }) {
  return item.direction === "out" ? "You" : item.senderName || "Contact";
}

function sharedTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MediaItem({
  item,
  onOpenMessage,
}: {
  item: SharedMessageDTO;
  onOpenMessage: (messageId: string) => void;
}) {
  const name = item.mediaName || `${item.mediaType || "Shared"} attachment`;
  const mediaPath = `${item.mediaName || ""} ${item.mediaUrl || ""}`.toLowerCase();
  const visualType = item.mediaType === "image" || /\.(png|jpe?g|gif|webp|heic|avif)(?:\?|$)/.test(mediaPath)
    ? "image"
    : item.mediaType === "video" || /\.(mp4|mov|webm|m4v)(?:\?|$)/.test(mediaPath)
      ? "video"
      : item.mediaType === "audio" || /\.(mp3|m4a|wav|ogg|aac)(?:\?|$)/.test(mediaPath)
        ? "audio"
        : item.mediaType;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-[#1F1F1F]">
      {visualType === "image" && item.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.mediaUrl} alt={name} className="aspect-square w-full object-cover" loading="lazy" />
      ) : visualType === "video" && item.mediaUrl ? (
        <video src={item.mediaUrl} controls preload="metadata" playsInline className="aspect-video w-full bg-black object-contain" />
      ) : visualType === "audio" && item.mediaUrl ? (
        <div className="p-3">
          <audio src={item.mediaUrl} controls preload="metadata" className="w-full" />
        </div>
      ) : (
        <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-3 py-4 text-center">
          <PaperclipIcon className="h-5 w-5 text-slate-400" />
          <span className="max-w-full truncate text-xs font-medium text-slate-600 dark:text-neutral-300">{name}</span>
          {item.mediaUrl && (
            <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accent hover:underline">
              Open file
            </a>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => onOpenMessage(item.id)}
        className="flex w-full items-center justify-between border-t border-slate-200 px-3 py-2 text-left text-[11px] text-slate-500 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <span className="truncate">{sharedSender(item)}</span>
        <span className="shrink-0">{sharedTime(item.createdAt)}</span>
      </button>
    </div>
  );
}

function SharedInChat({
  content,
  view,
  loading,
  error,
  onViewChange,
  onRefresh,
  onOpenMessage,
}: {
  content: SharedContentDTO;
  view: "pinned" | "media" | "links";
  loading: boolean;
  error: string | null;
  onViewChange: (view: "pinned" | "media" | "links") => void;
  onRefresh: () => void;
  onOpenMessage: (messageId: string) => void;
}) {
  const tabs = [
    { id: "pinned" as const, label: "Pinned", count: content.pinned.length, icon: PinIcon },
    { id: "media" as const, label: "Media", count: content.media.length, icon: PaperclipIcon },
    { id: "links" as const, label: "Links", count: content.links.length, icon: LinkIcon },
  ];
  const activeCount = content[view].length;

  return (
    <Section
      title="Shared in this chat"
      action={
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh shared items"
          aria-label="Refresh shared items"
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <RefreshIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#1F1F1F]" role="tablist" aria-label="Shared chat content">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(tab.id)}
              className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active
                  ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{tab.label}</span>
              <span className="text-[10px] font-medium opacity-60">{tab.count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>
        ) : loading && activeCount === 0 ? (
          <div className="space-y-2" aria-label="Loading shared items">
            <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800" />
            <div className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800" />
          </div>
        ) : activeCount === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center dark:border-neutral-700">
            <div className="text-sm font-medium text-slate-600 dark:text-neutral-300">
              {view === "pinned" ? "No pinned messages" : view === "media" ? "No shared media" : "No shared links"}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-400 dark:text-neutral-500">
              {view === "pinned"
                ? "Use the pin beside any message to keep it here."
                : `Anything shared in this conversation will appear here.`}
            </div>
          </div>
        ) : view === "pinned" ? (
          <div className="space-y-2">
            {content.pinned.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenMessage(item.id)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-accent/40 hover:bg-white active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:bg-[#1F1F1F] dark:hover:bg-neutral-800"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-accent">{sharedSender(item)}</span>
                  <span className="shrink-0 text-slate-400">{sharedTime(item.createdAt)}</span>
                </div>
                <div className="mt-1 max-h-16 overflow-hidden break-words text-xs leading-5 text-slate-700 dark:text-neutral-200">
                  {item.body || item.mediaName || (item.mediaType ? `${item.mediaType} attachment` : "Message")}
                </div>
              </button>
            ))}
          </div>
        ) : view === "media" ? (
          <div className="grid grid-cols-2 gap-2">
            {content.media.map((item) => (
              <MediaItem key={item.id} item={item} onOpenMessage={onOpenMessage} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {content.links.map((item) => {
              let host = item.url;
              try { host = new URL(item.url).hostname.replace(/^www\./, ""); } catch { /* show raw URL */ }
              return (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-neutral-700 dark:bg-[#1F1F1F]">
                  <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-accent hover:underline" title={item.url}>{host}</a>
                  <div className="mt-1 truncate text-xs text-slate-500 dark:text-neutral-400">{item.url}</div>
                  <button type="button" onClick={() => onOpenMessage(item.messageId)} className="mt-2 text-[11px] font-medium text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:text-neutral-200">
                    {sharedSender(item)} · {sharedTime(item.createdAt)}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

function Field({
  icon,
  label,
  value,
  placeholder,
  type = "text",
  editing,
  linkHref,
  linkLabel,
  onChange,
  onBlur,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  editing: boolean;
  linkHref?: string | null;
  linkLabel?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5">
      <span className="grid h-8 w-4 shrink-0 place-items-center text-slate-400 dark:text-neutral-500">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-slate-500 dark:text-neutral-400">
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
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-accent/50 focus:ring-2 focus:ring-accent/30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-accent/50 dark:focus:ring-accent/20"
          />
        ) : linkHref && value ? (
          <a
            href={linkHref}
            target="_blank"
            rel="noreferrer"
            title={value}
            className="block truncate text-sm font-semibold text-accent transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {linkLabel || value}
          </a>
        ) : (
          <span
            className={`block truncate text-sm ${
              value
                ? "text-slate-800 dark:text-neutral-100"
                : "text-slate-400 dark:text-neutral-500"
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
        <h3 className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
