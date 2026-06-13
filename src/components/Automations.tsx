"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type {
  ActionStep,
  AutomationDTO,
  AutomationMatchDTO,
  FolderDTO,
  TagDTO,
} from "@/lib/types";
import { PLATFORMS, PLATFORM_ORDER } from "@/lib/platforms";
import { Avatar } from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import { listTime } from "@/lib/time";
import {
  CheckCircleIcon,
  FolderIcon,
  PlusIcon,
  SendIcon,
  TrashIcon,
  ZapIcon,
} from "./icons";

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

type TriggerType =
  | "keyword"
  | "no_reply"
  | "unanswered"
  | "new_chat"
  | "broadcast";

type Draft = {
  id?: string;
  name: string;
  trigger: TriggerType;
  keyword: string;
  noReplyDays: number;
  platform: string;
  tagId: string;
  folderId: string;
  actions: ActionStep[];
  schedule: "manual" | "daily" | "every_n_days";
  everyNDays: number;
  cooldownDays: number;
};

const TRIGGERS: { id: TriggerType; label: string; daysLabel?: string }[] = [
  { id: "keyword", label: "Message contains a word" },
  { id: "no_reply", label: "They haven’t replied (you sent last)", daysLabel: "No reply for at least" },
  { id: "unanswered", label: "You haven’t replied (they sent last)", daysLabel: "Unanswered for at least" },
  { id: "new_chat", label: "New conversation", daysLabel: "Started within the last" },
  { id: "broadcast", label: "Everyone matching the filters" },
];

function emptyDraft(): Draft {
  return {
    name: "",
    trigger: "keyword",
    keyword: "",
    noReplyDays: 3,
    platform: "",
    tagId: "",
    folderId: "",
    actions: [
      { id: genId(), type: "send", message: "Hey {first}, just following up — " },
    ],
    schedule: "manual",
    everyNDays: 3,
    cooldownDays: 7,
  };
}

// Starter recipes shown when creating a new automation.
const TEMPLATES: { name: string; desc: string; draft: () => Draft }[] = [
  {
    name: "Follow up with quiet chats",
    desc: "Nudge people who haven’t replied in 3 days.",
    draft: () => ({
      ...emptyDraft(),
      name: "Follow up with quiet chats",
      trigger: "no_reply",
      noReplyDays: 3,
      actions: [
        { id: genId(), type: "send", message: "Hey {first}, just circling back — still interested?" },
      ],
    }),
  },
  {
    name: "Reply to anything I missed",
    desc: "Auto-acknowledge chats you haven’t answered in 2 days.",
    draft: () => ({
      ...emptyDraft(),
      name: "Reply to anything I missed",
      trigger: "unanswered",
      noReplyDays: 2,
      actions: [
        { id: genId(), type: "send", message: "Hey {first}, sorry for the slow reply! Picking this back up now." },
      ],
    }),
  },
  {
    name: "Welcome new chats",
    desc: "Greet anyone new from the last 3 days.",
    draft: () => ({
      ...emptyDraft(),
      name: "Welcome new chats",
      trigger: "new_chat",
      noReplyDays: 3,
      actions: [
        { id: genId(), type: "send", message: "Hey {first}, thanks for reaching out! How can I help?" },
      ],
    }),
  },
  {
    name: "Reply to “pricing”",
    desc: "Anyone who mentioned pricing gets your rate sheet.",
    draft: () => ({
      ...emptyDraft(),
      name: "Pricing replies",
      trigger: "keyword",
      keyword: "pricing",
      actions: [
        { id: genId(), type: "send", message: "Happy to share pricing, {first} — here are our plans:" },
      ],
    }),
  },
  {
    name: "Win back old leads",
    desc: "Re-open chats gone quiet for 14+ days.",
    draft: () => ({
      ...emptyDraft(),
      name: "Win-back",
      trigger: "no_reply",
      noReplyDays: 14,
      actions: [
        { id: genId(), type: "send", message: "Hey {first}, it’s been a while — want to pick this back up?" },
      ],
    }),
  },
  {
    name: "Broadcast to a tag",
    desc: "Message everyone with a chosen tag.",
    draft: () => ({
      ...emptyDraft(),
      name: "Broadcast",
      trigger: "broadcast",
      actions: [
        { id: genId(), type: "send", message: "Hi {first}, quick update for you —" },
      ],
    }),
  },
];

function summary(a: AutomationDTO): string {
  const d = a.noReplyDays ?? 3;
  const trig =
    a.trigger === "keyword"
      ? `Message contains “${a.keyword ?? ""}”`
      : a.trigger === "no_reply"
      ? `No reply for ${d} days`
      : a.trigger === "unanswered"
      ? `Unanswered for ${d} days`
      : a.trigger === "new_chat"
      ? `New chats (last ${d} days)`
      : "Everyone matching filters";
  const sched =
    a.schedule === "daily"
      ? " · daily"
      : a.schedule === "every_n_days"
      ? ` · every ${a.everyNDays ?? 1}d`
      : "";
  return trig + sched;
}

export function Automations() {
  const [autos, setAutos] = useState<AutomationDTO[]>([]);
  const [tags, setTags] = useState<TagDTO[]>([]);
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    fetch("/api/automations")
      .then((r) => r.json())
      .then((d: AutomationDTO[]) => {
        setAutos(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    fetch("/api/tags")
      .then((r) => r.json())
      .then(setTags)
      .catch(() => {});
    fetch("/api/folders")
      .then((r) => r.json())
      .then(setFolders)
      .catch(() => {});
  }, [reload]);

  async function toggle(a: AutomationDTO) {
    setAutos((xs) =>
      xs.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x))
    );
    await fetch(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    }).catch(() => {});
  }

  async function del(a: AutomationDTO) {
    setAutos((xs) => xs.filter((x) => x.id !== a.id));
    await fetch(`/api/automations/${a.id}`, { method: "DELETE" }).catch(() => {});
  }

  async function run(a: AutomationDTO) {
    setRunning(a.id);
    try {
      const res = await fetch(`/api/automations/${a.id}/run`, { method: "POST" });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || "Run failed");
      setToast(
        `${a.name}: ${r.sent} sent · ${r.skipped} skipped${
          r.failed ? ` · ${r.failed} failed` : ""
        }`
      );
      reload();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRunning(null);
      setTimeout(() => setToast(null), 6000);
    }
  }

  function edit(a: AutomationDTO) {
    setEditing({
      id: a.id,
      name: a.name,
      trigger: a.trigger,
      keyword: a.keyword ?? "",
      noReplyDays: a.noReplyDays ?? 3,
      platform: a.platform ?? "",
      tagId: a.tagId ?? "",
      folderId: a.folderId ?? "",
      actions: a.actions.length
        ? a.actions
        : [{ id: genId(), type: "send", message: a.message }],
      schedule: a.schedule,
      everyNDays: a.everyNDays ?? 3,
      cooldownDays: a.cooldownDays,
    });
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <nav className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-neutral-800">
          <Link
            href="/"
            className="rounded-md px-2.5 py-1 text-slate-500 transition hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Inbox
          </Link>
          <Link
            href="/board"
            className="rounded-md px-2.5 py-1 text-slate-500 transition hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Board
          </Link>
          <span className="rounded-md bg-white px-2.5 py-1 text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100">
            Automations
          </span>
        </nav>
        <ThemeToggle />
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
                Automations
              </h1>
              <p className="text-sm text-slate-500 dark:text-neutral-400">
                Reach the right chats automatically — by keyword or by going
                quiet.
              </p>
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setPicking(true)}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              <ZapIcon className="h-4 w-4" />
              New automation
            </motion.button>
          </div>

          {loading && (
            <div className="py-16 text-center text-sm text-slate-400 dark:text-neutral-500">
              Loading…
            </div>
          )}

          {!loading && autos.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center dark:border-neutral-800">
              <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                <ZapIcon className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-neutral-200">
                No automations yet
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400 dark:text-neutral-500">
                e.g. “message everyone who said <b>pricing</b>” or “follow up
                with anyone who hasn’t replied in 3 days.”
              </p>
            </div>
          )}

          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {autos.map((a) => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="group rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggle(a)}
                      title={a.enabled ? "Enabled" : "Disabled"}
                      className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                        a.enabled
                          ? "bg-blue-600"
                          : "bg-slate-300 dark:bg-neutral-700"
                      }`}
                    >
                      <motion.span
                        layout
                        className={`h-4 w-4 rounded-full bg-white ${
                          a.enabled ? "ml-auto" : ""
                        }`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900 dark:text-neutral-100">
                          {a.name || "Untitled"}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                          {a.matchCount} match{a.matchCount === 1 ? "" : "es"}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">
                        {summary(a)}
                      </div>
                      <div className="mt-1.5 truncate text-sm text-slate-600 dark:text-neutral-300">
                        “{a.message}”
                      </div>
                      {a.lastRunAt && (
                        <div className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
                          Last run {listTime(a.lastRunAt)}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => run(a)}
                        disabled={running === a.id || a.matchCount === 0}
                        className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                      >
                        {running === a.id ? "Running…" : "Run now"}
                      </motion.button>
                      <button
                        onClick={() => edit(a)}
                        className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => del(a)}
                        aria-label="Delete"
                        className="rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-neutral-800"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {picking && (
          <TemplatePicker
            onClose={() => setPicking(false)}
            onPick={(draft) => {
              setPicking(false);
              setEditing(draft);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing && (
          <Builder
            initial={editing}
            tags={tags}
            folders={folders}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TemplatePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (draft: Draft) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-base font-semibold dark:text-neutral-100">
            Start from a template
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
        <div className="scroll-thin grid flex-1 grid-cols-2 gap-2.5 overflow-y-auto p-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              onClick={() => onPick(t.draft())}
              className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-neutral-800 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/5"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  <ZapIcon className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">
                  {t.name}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-neutral-400">
                {t.desc}
              </p>
            </button>
          ))}
          <button
            onClick={() => onPick(emptyDraft())}
            className="col-span-2 rounded-xl border border-dashed border-slate-300 p-3 text-center text-sm font-medium text-slate-500 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Start from scratch
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Builder({
  initial,
  tags,
  folders,
  onClose,
  onSaved,
}: {
  initial: Draft;
  tags: TagDTO[];
  folders: FolderDTO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [preview, setPreview] = useState<{
    total: number;
    matches: AutomationMatchDTO[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const firstSend = d.actions.find((a) => a.type === "send") as
    | { message: string }
    | undefined;

  function updateAction(id: string, patch: Record<string, unknown>) {
    set({
      actions: d.actions.map((a) =>
        a.id === id ? ({ ...a, ...patch } as ActionStep) : a
      ),
    });
  }
  function removeAction(id: string) {
    set({ actions: d.actions.filter((a) => a.id !== id) });
  }
  function addAction(type: ActionStep["type"]) {
    const step: ActionStep =
      type === "send"
        ? { id: genId(), type: "send", message: "" }
        : type === "tag"
        ? { id: genId(), type: "tag", tagId: tags[0]?.id ?? "" }
        : { id: genId(), type: "status", status: "done" };
    set({ actions: [...d.actions, step] });
    setAddOpen(false);
  }

  // Debounced live dry-run as the rule changes.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch("/api/automations/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...d, message: firstSend?.message ?? "" }),
      })
        .then((r) => r.json())
        .then(setPreview)
        .catch(() => {});
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    const url = d.id ? `/api/automations/${d.id}` : "/api/automations";
    await fetch(url, {
      method: d.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    }).catch(() => {});
    setSaving(false);
    onSaved();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-base font-semibold dark:text-neutral-100">
            {d.id ? "Edit automation" : "New automation"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            ✕
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
          <Labeled label="Name">
            <input
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Pricing follow-up"
              className={inputCls}
            />
          </Labeled>

          {/* ── Node flow ── */}
          <div className="flex flex-col">
            {/* Trigger node */}
            <div className="rounded-xl border border-amber-200 bg-white dark:border-amber-500/30 dark:bg-neutral-900">
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                  <ZapIcon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  When
                </span>
              </div>
              <div className="space-y-2.5 p-3">
                <select
                  value={d.trigger}
                  onChange={(e) =>
                    set({ trigger: e.target.value as TriggerType })
                  }
                  className={inputCls}
                >
                  {TRIGGERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>

                {d.trigger === "keyword" && (
                  <input
                    value={d.keyword}
                    onChange={(e) => set({ keyword: e.target.value })}
                    placeholder="Keyword or phrase, e.g. pricing"
                    className={inputCls}
                  />
                )}
                {(d.trigger === "no_reply" ||
                  d.trigger === "unanswered" ||
                  d.trigger === "new_chat") && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-neutral-400">
                      {TRIGGERS.find((t) => t.id === d.trigger)?.daysLabel}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={d.noReplyDays}
                      onChange={(e) =>
                        set({ noReplyDays: Number(e.target.value) || 1 })
                      }
                      className={`${inputCls} w-20`}
                    />
                    <span className="text-xs text-slate-500 dark:text-neutral-400">
                      days
                    </span>
                  </div>
                )}

                <div className="flex gap-2">
                  <select
                    value={d.platform}
                    onChange={(e) => set({ platform: e.target.value })}
                    className={`${inputCls} flex-1`}
                  >
                    <option value="">Any platform</option>
                    {PLATFORM_ORDER.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORMS[p].label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={d.tagId}
                    onChange={(e) => set({ tagId: e.target.value })}
                    className={`${inputCls} flex-1`}
                  >
                    <option value="">Any tag</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={d.folderId}
                    onChange={(e) => set({ folderId: e.target.value })}
                    className={`${inputCls} flex-1`}
                  >
                    <option value="">Any folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Action nodes */}
            {d.actions.map((a) => {
              const meta =
                a.type === "send"
                  ? {
                      label: "Send message",
                      icon: <SendIcon className="h-3.5 w-3.5" />,
                      chip: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
                    }
                  : a.type === "tag"
                  ? {
                      label: "Add tag",
                      icon: <FolderIcon className="h-3.5 w-3.5" />,
                      chip: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
                    }
                  : {
                      label: "Set status",
                      icon: <CheckCircleIcon className="h-3.5 w-3.5" />,
                      chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
                    };
              return (
                <div key={a.id}>
                  <div className="mx-auto h-4 w-0.5 bg-slate-200 dark:bg-neutral-700" />
                  <div className="rounded-xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-md ${meta.chip}`}
                      >
                        {meta.icon}
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                        Then · {meta.label}
                      </span>
                      <button
                        onClick={() => removeAction(a.id)}
                        aria-label="Remove step"
                        className="ml-auto rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-red-500 dark:hover:bg-neutral-800"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="p-3">
                      {a.type === "send" && (
                        <>
                          <textarea
                            value={a.message}
                            onChange={(e) =>
                              updateAction(a.id, { message: e.target.value })
                            }
                            rows={2}
                            placeholder="Hey {first}, just checking in…"
                            className={`${inputCls} resize-none`}
                          />
                          <span className="mt-1 block text-[11px] text-slate-400 dark:text-neutral-500">
                            Use {"{first}"} or {"{name}"} to personalize.
                          </span>
                        </>
                      )}
                      {a.type === "tag" && (
                        <select
                          value={a.tagId}
                          onChange={(e) =>
                            updateAction(a.id, { tagId: e.target.value })
                          }
                          className={inputCls}
                        >
                          {tags.length === 0 && (
                            <option value="">No tags yet</option>
                          )}
                          {tags.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {a.type === "status" && (
                        <select
                          value={a.status}
                          onChange={(e) =>
                            updateAction(a.id, { status: e.target.value })
                          }
                          className={inputCls}
                        >
                          <option value="done">Mark done</option>
                          <option value="open">Mark needs reply</option>
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add step */}
            <div className="mx-auto h-4 w-0.5 bg-slate-200 dark:bg-neutral-700" />
            <div className="relative flex justify-center">
              <button
                onClick={() => setAddOpen((v) => !v)}
                className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <PlusIcon className="h-3.5 w-3.5" /> Add step
              </button>
              <AnimatePresence>
                {addOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full z-10 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    {(
                      [
                        ["send", "Send message"],
                        ["tag", "Add tag"],
                        ["status", "Set status"],
                      ] as [ActionStep["type"], string][]
                    ).map(([t, l]) => (
                      <button
                        key={t}
                        onClick={() => addAction(t)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        {l}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex gap-3">
            <Labeled label="Run" className="flex-1">
              <select
                value={d.schedule}
                onChange={(e) =>
                  set({ schedule: e.target.value as Draft["schedule"] })
                }
                className={inputCls}
              >
                <option value="manual">Manually (Run now)</option>
                <option value="daily">Daily</option>
                <option value="every_n_days">Every N days</option>
              </select>
            </Labeled>
            {d.schedule === "every_n_days" && (
              <Labeled label="Every (days)" className="w-28">
                <input
                  type="number"
                  min={1}
                  value={d.everyNDays}
                  onChange={(e) =>
                    set({ everyNDays: Number(e.target.value) || 1 })
                  }
                  className={inputCls}
                />
              </Labeled>
            )}
            <Labeled label="Cooldown (days)" className="w-32">
              <input
                type="number"
                min={0}
                value={d.cooldownDays}
                onChange={(e) =>
                  set({ cooldownDays: Number(e.target.value) || 0 })
                }
                className={inputCls}
              />
            </Labeled>
          </div>

          {/* Live dry-run */}
          <div className="rounded-xl border border-slate-200 dark:border-neutral-800">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-semibold dark:border-neutral-800">
              <span className="text-slate-500 dark:text-neutral-400">
                Targets right now
              </span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                {preview ? preview.total : "…"} chat
                {preview && preview.total === 1 ? "" : "s"}
              </span>
            </div>
            <div className="scroll-thin max-h-44 overflow-y-auto p-1.5">
              {preview && preview.matches.length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-slate-400 dark:text-neutral-500">
                  No chats match yet.
                </div>
              )}
              {preview?.matches.map((m) => (
                <div
                  key={m.conversationId}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                >
                  <Avatar
                    name={m.name}
                    platform={m.platform}
                    size="sm"
                    src={m.avatarUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-800 dark:text-neutral-100">
                      {m.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-400 dark:text-neutral-500">
                      → {m.preview}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-neutral-800">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={save}
            disabled={saving || d.actions.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? "Saving…" : d.id ? "Save" : "Create"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const inputCls =
  "w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus:ring-blue-500/40";

function Labeled({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </label>
  );
}
