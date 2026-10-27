"use client";

import { OverlayPortal } from "./OverlayPortal";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { ConversationDTO } from "@/lib/types";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { Avatar } from "./Avatar";
import { CheckCircleIcon, CopyIcon, LinkIcon } from "./icons";
import {
  loadSettings,
  saveSettings,
  type GroupMacro,
  type GroupTemplate,
} from "@/lib/settings";

const GROUP_PLATFORMS: Platform[] = ["telegram", "whatsapp", "gmail", "x", "discord"];
const GROUP_SUPPORT: Record<Platform, { enabled: boolean; note: string; requiresMessage?: boolean }> = {
  telegram: { enabled: true, note: "Creates a native Telegram group." },
  whatsapp: { enabled: true, note: "Creates a native WhatsApp group." },
  gmail: { enabled: true, requiresMessage: true, note: "Starts one group email thread for everyone." },
  x: { enabled: false, note: "X does not give this connection safe permission to create group DMs." },
  discord: { enabled: false, note: "Official Discord bots cannot create private group DMs. Create a server channel in Discord." },
};

type Person = {
  contactId: string;
  name: string;
  platform: Platform;
  avatarUrl: string | null;
};

type ParticipantOutcome = {
  contactId: string | null;
  name: string;
  participantKey: string;
  status: "added" | "invite_sent" | "not_added";
  detail?: string;
};

type CreationResult = {
  chatExternalId: string;
  inviteUrl?: string;
  participantOutcomes: ParticipantOutcome[];
};

export function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [platform, setPlatform] = useState<Platform>("telegram");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creationResult, setCreationResult] = useState<CreationResult | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [macros, setMacros] = useState<GroupMacro[]>([]);
  const [templates, setTemplates] = useState<GroupTemplate[]>([]);

  useEffect(() => {
    setMacros(loadSettings().macros);
    setTemplates(loadSettings().templates);
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((cs: ConversationDTO[]) => {
        const seen = new Set<string>();
        const list: Person[] = [];
        for (const c of cs) {
          if (c.isGroup) continue;
          if (!GROUP_PLATFORMS.includes(c.platform as Platform)) continue;
          if (seen.has(c.contact.id)) continue;
          seen.add(c.contact.id);
          list.push({
            contactId: c.contact.id,
            name: c.contact.name,
            platform: c.platform as Platform,
            avatarUrl: c.contact.avatarUrl,
          });
        }
        setPeople(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => p.platform === platform)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 80);
  }, [people, platform, query]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function loadMacro(m: GroupMacro) {
    setPlatform(m.platform as Platform);
    setGroupName(m.groupName);
    setMessage(m.message);
    setSelected(new Set(m.contactIds));
  }
  function persist(next: GroupMacro[]) {
    setMacros(next);
    saveSettings({ ...loadSettings(), macros: next });
  }
  function saveMacro() {
    if (!groupName.trim() || !selected.size) return;
    persist([
      ...macros,
      {
        id: "m" + Math.random().toString(36).slice(2, 7),
        label: groupName.trim(),
        platform,
        groupName: groupName.trim(),
        contactIds: [...selected],
        message,
      },
    ]);
  }

  // Templates = the group's purpose (name + message), no fixed people.
  function persistTemplates(next: GroupTemplate[]) {
    setTemplates(next);
    saveSettings({ ...loadSettings(), templates: next });
  }
  function applyTemplate(t: GroupTemplate) {
    setGroupName(t.groupName);
    setMessage(t.message);
  }
  function saveTemplate() {
    if (!groupName.trim()) return;
    persistTemplates([
      ...templates,
      {
        id: "t" + Math.random().toString(36).slice(2, 7),
        label: groupName.trim(),
        groupName: groupName.trim(),
        message,
      },
    ]);
  }

  async function create() {
    const support = GROUP_SUPPORT[platform];
    if (!support.enabled) {
      setError(support.note);
      return;
    }
    if (!groupName.trim() || !selected.size || busy) {
      setError("Add a name and at least one person.");
      return;
    }
    if (support.requiresMessage && !message.trim()) {
      setError("Add a first message to start the group email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/groups/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          name: groupName.trim(),
          contactIds: [...selected],
          message: message.trim(),
        }),
      });
      const d = (await r.json()) as CreationResult & { error?: string };
      if (!r.ok) {
        setError(d.error || "Couldn't create the group.");
        setBusy(false);
        return;
      }
      setCreationResult(d);
      setBusy(false);
      onCreated(`Created "${groupName.trim()}" with ${selected.size} people`);
    } catch {
      setError("Couldn't reach the server.");
      setBusy(false);
    }
  }

  return (
    <OverlayPortal onClose={busy ? undefined : onClose}><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-group-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-neutral-700">
          <h2 id="create-group-title" className="text-base font-semibold dark:text-neutral-100">
            {creationResult ? "Group created" : "New group chat"}
          </h2>
          <button
            onClick={() => !busy && onClose()}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
          {creationResult ? (
            <div className="py-2">
              <div className="mb-5 flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
                  <CheckCircleIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900 dark:text-neutral-100">
                    {groupName.trim()} is ready
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
                    {creationResult.participantOutcomes.filter((outcome) => outcome.status === "added").length} added
                    {creationResult.participantOutcomes.some((outcome) => outcome.status === "invite_sent")
                      ? ` · ${creationResult.participantOutcomes.filter((outcome) => outcome.status === "invite_sent").length} invited privately`
                      : ""}
                  </p>
                </div>
              </div>

              {creationResult.participantOutcomes.some(
                (outcome) => outcome.status !== "added"
              ) ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                    People who needed an invite
                  </p>
                  {creationResult.participantOutcomes
                    .filter((outcome) => outcome.status !== "added")
                    .map((outcome) => (
                      <div
                        key={`${outcome.participantKey}-${outcome.name}`}
                        className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-neutral-700"
                      >
                        <span
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                            outcome.status === "invite_sent"
                              ? "bg-accent/15 text-accent"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <span className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">
                              {outcome.name}
                            </span>
                            <span
                              className={`text-xs font-semibold ${
                                outcome.status === "invite_sent"
                                  ? "text-accent"
                                  : "text-amber-700 dark:text-amber-300"
                              }`}
                            >
                              {outcome.status === "invite_sent"
                                ? "Invite link sent"
                                : "Invite not sent"}
                            </span>
                          </div>
                          {outcome.detail && (
                            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                              {outcome.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="rounded-xl bg-accent/10 px-4 py-3 text-sm text-slate-600 dark:text-neutral-300">
                  Everyone was added directly to the group.
                </div>
              )}

              {creationResult.inviteUrl &&
                creationResult.participantOutcomes.some(
                  (outcome) => outcome.status === "not_added"
                ) && (
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(creationResult.inviteUrl!);
                      setCopiedInvite(true);
                      window.setTimeout(() => setCopiedInvite(false), 1800);
                    }}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <CopyIcon className="h-4 w-4" />
                    {copiedInvite ? "Invite link copied" : "Copy invite link"}
                  </button>
                )}
            </div>
          ) : (
            <>
          {/* Templates — the group's purpose (name + message), pick people fresh */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                Templates
              </span>
              <button
                onClick={saveTemplate}
                disabled={!groupName.trim()}
                className="text-[11px] font-medium text-accent transition disabled:opacity-40"
              >
                + Save current as template
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-slate-400 dark:text-neutral-500">
                None yet. Set a group name + message and hit “Save current”, or
                just make a new group below.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <span
                    key={t.id}
                    className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    <button
                      onClick={() => applyTemplate(t)}
                      className="font-medium"
                      title="Use this template"
                    >
                      {t.label}
                    </button>
                    <button
                      onClick={() =>
                        persistTemplates(templates.filter((x) => x.id !== t.id))
                      }
                      title="Delete template"
                      className="grid h-4 w-4 place-items-center rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-neutral-700"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Saved macros */}
          {macros.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                Macros
              </div>
              <div className="flex flex-wrap gap-1.5">
                {macros.map((m) => (
                  <span
                    key={m.id}
                    className="flex items-center gap-1 rounded-full bg-accent/15 py-1 pl-2.5 pr-1 text-xs text-accent"
                  >
                    <button onClick={() => loadMacro(m)} className="font-medium">
                      {m.label} · {m.contactIds.length}
                    </button>
                    <button
                      onClick={() => persist(macros.filter((x) => x.id !== m.id))}
                      title="Delete macro"
                      className="grid h-4 w-4 place-items-center rounded-full hover:bg-accent/20"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Platform */}
          <div className="mb-2 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-neutral-900">
            {GROUP_PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPlatform(p);
                  setSelected(new Set());
                  setError(null);
                }}
                className={`min-w-0 rounded-lg px-1 py-2 text-[11px] font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  platform === p
                    ? "bg-white text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <span className="block truncate">{PLATFORMS[p].label}</span>
              </button>
            ))}
          </div>

          <div className={`mb-3 rounded-lg px-3 py-2 text-xs leading-5 ${
            GROUP_SUPPORT[platform].enabled
              ? "bg-accent/10 text-slate-600 dark:text-neutral-300"
              : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          }`}>
            {GROUP_SUPPORT[platform].note}
          </div>

          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name"
            className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Add people on ${PLATFORMS[platform].label}…`}
            className="mb-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="mb-2 max-h-48 overflow-y-auto scroll-thin rounded-lg border border-slate-100 dark:border-neutral-700/60">
            {results.length === 0 && (
              <p className="px-3 py-3 text-center text-xs text-slate-400 dark:text-neutral-500">
                No contacts found.
              </p>
            )}
            {results.map((p) => (
              <button
                key={p.contactId}
                onClick={() => toggle(p.contactId)}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition ${
                  selected.has(p.contactId)
                    ? "bg-accent/15"
                    : "hover:bg-slate-50 dark:hover:bg-neutral-700/60"
                }`}
              >
                <Avatar
                  name={p.name}
                  platform={p.platform}
                  size="xs"
                  showBadge={false}
                  src={p.avatarUrl}
                />
                <span className="min-w-0 flex-1 truncate text-sm dark:text-neutral-100">
                  {p.name}
                </span>
                <span
                  className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${
                    selected.has(p.contactId)
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-slate-300 text-transparent dark:border-neutral-600"
                  }`}
                >
                  ✓
                </span>
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={GROUP_SUPPORT[platform].requiresMessage ? "First message (required)" : "First message (optional)"}
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3 dark:border-neutral-700">
          {creationResult ? (
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-800"
            >
              Done
            </button>
          ) : (
            <>
          {error ? (
            <span className="flex-1 truncate text-xs text-red-500">{error}</span>
          ) : (
            <button
              onClick={saveMacro}
              disabled={!groupName.trim() || !selected.size}
              className="flex-1 text-left text-xs text-slate-400 transition hover:text-slate-600 disabled:opacity-50 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              {selected.size} selected · Save as macro
            </button>
          )}
          <button
            onClick={create}
            disabled={busy || !GROUP_SUPPORT[platform].enabled || !groupName.trim() || !selected.size || Boolean(GROUP_SUPPORT[platform].requiresMessage && !message.trim())}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create group"}
          </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div></OverlayPortal>
  );
}
