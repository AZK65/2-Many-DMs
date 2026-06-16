"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type {
  ConversationDTO,
  FolderDTO,
  SnippetDTO,
  TagDTO,
} from "@/lib/types";
import {
  PLATFORM_ORDER,
  PLATFORMS,
  type Platform,
} from "@/lib/platforms";
import { listTime, snoozeLabel } from "@/lib/time";
import { Avatar } from "./Avatar";
import { ChatThread } from "./ChatThread";
import { ContactPanel } from "./ContactPanel";
import { PlatformGlyph } from "./PlatformIcon";
import ThemeToggle from "./ThemeToggle";
import { SettingsModal } from "./SettingsModal";
import {
  loadSettings,
  applySettings,
  DEFAULT_SETTINGS,
  type Settings,
} from "@/lib/settings";
import { SnippetsModal } from "./SnippetsModal";
import { CommandPalette } from "./CommandPalette";
import {
  ConnectionsModal,
  type ConnectionsData,
} from "./ConnectionsModal";
import {
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FunnelIcon,
  InfoIcon,
  LinkIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
} from "./icons";

type InboxView = "all" | "needsreply" | "cold" | "snoozed" | "done";

function isSnoozed(c: ConversationDTO): boolean {
  return !!c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now();
}

// Days since the chat was last "touched" — a new message OR you opening it.
// Opening a chat resets the cold clock so reviewed chats stop nagging.
function coldDays(c: ConversationDTO): number {
  const touched = Math.max(
    new Date(c.lastMessageAt).getTime(),
    c.lastOpenedAt ? new Date(c.lastOpenedAt).getTime() : 0
  );
  return Math.floor((Date.now() - touched) / 86_400_000);
}

function snoozePresets(): { label: string; date: Date }[] {
  const at9 = (d: Date) => {
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const nextWeek = new Date();
  const add = (8 - nextWeek.getDay()) % 7 || 7; // next Monday
  nextWeek.setDate(nextWeek.getDate() + add);
  return [
    { label: "Tomorrow", date: at9(new Date(Date.now() + 86_400_000)) },
    { label: "In 3 days", date: at9(new Date(Date.now() + 3 * 86_400_000)) },
    { label: "Next week", date: at9(nextWeek) },
  ];
}

export function Inbox() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [tags, setTags] = useState<TagDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [tagFilter, setTagFilter] = useState<string | "all">("all");
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | "all">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useState<InboxView>("needsreply");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  // Load + apply saved preferences on mount; re-read when they change.
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    applySettings(s);
    setView(s.defaultView);
    const onChange = () => setSettings(loadSettings());
    window.addEventListener("tmd-settings", onChange);
    return () => window.removeEventListener("tmd-settings", onChange);
  }, []);
  const [showFilters, setShowFilters] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingFolderConvId, setPendingFolderConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnectionsData | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  // Contact CRM panel is hidden until the user opens it for the current chat.
  const [showContact, setShowContact] = useState(false);
  const [snippets, setSnippets] = useState<SnippetDTO[]>([]);
  const [showSnippets, setShowSnippets] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // First-run: send new users to the onboarding screen.
  useEffect(() => {
    try {
      if (!localStorage.getItem("onboarded")) router.replace("/welcome");
    } catch {}
  }, [router]);

  useEffect(() => {
    Promise.all([
      fetch("/api/conversations").then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
      fetch("/api/folders").then((r) => r.json()),
      fetch("/api/snippets").then((r) => r.json()),
    ]).then(
      ([convs, tg, fl, sn]: [
        ConversationDTO[],
        TagDTO[],
        FolderDTO[],
        SnippetDTO[]
      ]) => {
        setConversations(convs);
        setTags(tg);
        setFolders(fl);
        setSnippets(sn);
        setSelectedId((cur) => cur ?? convs[0]?.id ?? null);
        setLoading(false);
      }
    );
  }, []);

  // Poll for new inbound messages synced by the worker. Selection lives in its
  // own state, so refreshing the list never changes which thread is open.
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/conversations")
        .then((r) => r.json())
        .then((convs: ConversationDTO[]) => setConversations(convs))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // ⌘K / Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Poll platform connection status so the Connections panel and its dot stay
  // live (e.g. WhatsApp QR → connected as soon as it's scanned).
  useEffect(() => {
    const load = () =>
      fetch("/api/connections")
        .then((r) => r.json())
        .then((d: ConnectionsData) => setConnections(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  // Chats passing the category filters (folder/platform/tag + hidden bucket),
  // before the lifecycle (status) view is applied. Used for the view counts.
  const scoped = useMemo(() => {
    return conversations.filter((c) => {
      if (showHidden ? !c.hidden : c.hidden) return false;
      if (folderFilter !== "all" && !c.folderIds.includes(folderFilter))
        return false;
      if (platformFilter !== "all" && c.platform !== platformFilter)
        return false;
      if (tagFilter !== "all" && !c.contact.tags.some((t) => t.id === tagFilter))
        return false;
      return true;
    });
  }, [conversations, platformFilter, tagFilter, folderFilter, showHidden]);

  function matchesView(c: ConversationDTO, v: InboxView): boolean {
    const snoozed = isSnoozed(c);
    if (v === "snoozed") return snoozed;
    if (v === "done") return c.status === "done";
    if (c.status === "done" || snoozed) return false;
    if (v === "all") return true; // every active (non-done, non-snoozed) chat
    // Whose turn is it? Derived from the last message direction:
    //  - they messaged last (or no messages) → Needs reply (your turn)
    //  - you messaged last → Cold (you replied, waiting on them)
    if (v === "needsreply") return c.lastDirection !== "out";
    if (v === "cold") return c.lastDirection === "out";
    return false;
  }

  const viewCounts = useMemo(() => {
    const counts: Record<InboxView, number> = {
      all: 0,
      needsreply: 0,
      cold: 0,
      snoozed: 0,
      done: 0,
    };
    for (const c of scoped)
      for (const v of ["all", "needsreply", "cold", "snoozed", "done"] as InboxView[])
        if (matchesView(c, v)) counts[v]++;
    return counts;
  }, [scoped]);

  const filtered = useMemo(() => {
    return scoped
      .filter((c) => showHidden || matchesView(c, view))
      .sort((a, b) => {
        // Cold view: longest-waiting (stalest) first.
        if (view === "cold") return coldDays(b) - coldDays(a);
        // Otherwise pinned first, then most-recent.
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime()
        );
      });
  }, [scoped, view, showHidden]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  function selectConversation(id: string) {
    setSelectedId(id);
    const now = new Date().toISOString();
    setConversations((cs) =>
      cs.map((c) => (c.id === id ? { ...c, unread: 0, lastOpenedAt: now } : c))
    );
  }

  function handleSent(convId: string, preview: string) {
    setConversations((cs) =>
      cs
        .map((c) =>
          c.id === convId
            ? {
                ...c,
                lastMessage: preview,
                lastMessageAt: new Date().toISOString(),
                // You replied → moves to Cold (waiting on them), clears Done.
                lastDirection: "out" as const,
                status: "open" as const,
                snoozedUntil: null,
              }
            : c
        )
        .sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime()
        )
    );
  }

  function handleTagsChanged(contactId: string, newTags: TagDTO[]) {
    setConversations((cs) =>
      cs.map((c) =>
        c.contact.id === contactId
          ? { ...c, contact: { ...c.contact, tags: newTags } }
          : c
      )
    );
  }

  function handleContactChanged(
    contactId: string,
    patch: Partial<ConversationDTO["contact"]>
  ) {
    setConversations((cs) =>
      cs.map((c) =>
        c.contact.id === contactId
          ? { ...c, contact: { ...c.contact, ...patch } }
          : c
      )
    );
  }

  function patchConversation(id: string, patch: Partial<ConversationDTO>) {
    setConversations((cs) =>
      cs.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function togglePin(c: ConversationDTO) {
    patchConversation(c.id, { pinned: !c.pinned });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !c.pinned }),
    }).catch(() => {});
  }

  function setStatus(c: ConversationDTO, status: ConversationDTO["status"]) {
    patchConversation(c.id, { status, snoozedUntil: null });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, snoozedUntil: null }),
    }).catch(() => {});
  }

  function snooze(c: ConversationDTO, until: Date) {
    const iso = until.toISOString();
    patchConversation(c.id, { snoozedUntil: iso });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snoozedUntil: iso }),
    }).catch(() => {});
  }

  function toggleHide(c: ConversationDTO) {
    patchConversation(c.id, { hidden: !c.hidden });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: !c.hidden }),
    }).catch(() => {});
  }

  function toggleFolder(c: ConversationDTO, folderId: string) {
    const inFolder = c.folderIds.includes(folderId);
    patchConversation(c.id, {
      folderIds: inFolder
        ? c.folderIds.filter((f) => f !== folderId)
        : [...c.folderIds, folderId],
    });
    fetch(`/api/conversations/${c.id}/folders${inFolder ? `?folderId=${folderId}` : ""}`, {
      method: inFolder ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: inFolder ? undefined : JSON.stringify({ folderId }),
    }).catch(() => {});
  }

  // Bulk-add several chats to a folder (used by the command palette).
  async function addConvsToFolder(convIds: string[], folderId: string) {
    setConversations((cs) =>
      cs.map((c) =>
        convIds.includes(c.id) && !c.folderIds.includes(folderId)
          ? { ...c, folderIds: [...c.folderIds, folderId] }
          : c
      )
    );
    await Promise.all(
      convIds.map((id) =>
        fetch(`/api/conversations/${id}/folders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        }).catch(() => {})
      )
    );
  }

  async function createFolderReturning(name: string): Promise<FolderDTO> {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const folder: FolderDTO = await res.json();
    setFolders((f) => [...f, folder]);
    return folder;
  }

  function openNewFolder(convId: string | null) {
    setPendingFolderConvId(convId);
    setNewFolderName("");
    setNewFolderOpen(true);
  }

  async function submitNewFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const folder: FolderDTO = await res.json();
    setFolders((f) => [...f, folder]);

    if (pendingFolderConvId) {
      const conv = conversations.find((c) => c.id === pendingFolderConvId);
      if (conv) {
        patchConversation(conv.id, {
          folderIds: [...conv.folderIds, folder.id],
        });
        fetch(`/api/conversations/${conv.id}/folders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: folder.id }),
        }).catch(() => {});
      }
    } else {
      setShowHidden(false);
      setFolderFilter(folder.id);
    }

    setNewFolderOpen(false);
    setNewFolderName("");
    setPendingFolderConvId(null);
  }

  const connDot = (() => {
    if (!connections || !connections.workerRunning) return "#94a3b8";
    const states = Object.values(connections.platforms).map((p) => p.state);
    if (states.includes("qr")) return "#f59e0b";
    if (states.includes("disconnected")) return "#ef4444";
    if (states.some((s) => s === "ready")) return "#22c55e";
    return "#3b82f6";
  })();

  const activeFilters =
    (platformFilter !== "all" ? 1 : 0) + (tagFilter !== "all" ? 1 : 0);

  // Pinned chats render as an Apple-Messages-style avatar grid up top; the rest
  // stay as list rows.
  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);

  // Contacts that appear on more than one account — those rows get a "via" tag
  // so you can tell the same person's chats apart.
  const nameCounts = new Map<string, number>();
  for (const c of conversations) {
    const k = c.contact.name.trim().toLowerCase();
    nameCounts.set(k, (nameCounts.get(k) || 0) + 1);
  }
  const dupAccountTag = (c: ConversationDTO): string | null => {
    if (!c.account?.label) return null;
    if ((nameCounts.get(c.contact.name.trim().toLowerCase()) || 0) <= 1) return null;
    const l = c.account.label;
    return l.startsWith("@") ? l : "…" + (l.replace(/\D/g, "").slice(-4) || l);
  };

  // The per-chat actions menu, reused by both the list rows and pinned tiles.
  function convActionsMenu(c: ConversationDTO, positionClass: string) {
    return (
      <AnimatePresence>
        {menuId === c.id && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.13, ease: "easeOut" }}
            className={`absolute z-30 w-60 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-800 ${positionClass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              Status
            </div>
            <div className="px-2.5 pb-1 text-xs text-slate-400 dark:text-neutral-500">
              {c.lastDirection === "out"
                ? "Cold · waiting on them to reply"
                : "Needs reply · your turn"}
            </div>
            {c.status === "done" ? (
              <MenuRow
                icon={<ReplyIcon className="h-4 w-4" />}
                onClick={() => {
                  setStatus(c, "open");
                  setMenuId(null);
                }}
              >
                Reopen
              </MenuRow>
            ) : (
              <MenuRow
                icon={<CheckCircleIcon className="h-4 w-4" />}
                onClick={() => {
                  setStatus(c, "done");
                  setMenuId(null);
                }}
              >
                Mark done
              </MenuRow>
            )}

            <div className="my-1 h-px bg-slate-100 dark:bg-neutral-700" />
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              {isSnoozed(c) ? `Snoozed · ${snoozeLabel(c.snoozedUntil!)}` : "Snooze"}
            </div>
            {isSnoozed(c) && (
              <MenuRow
                icon={<ClockIcon className="h-4 w-4" />}
                onClick={() => {
                  patchConversation(c.id, { snoozedUntil: null });
                  fetch(`/api/conversations/${c.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ snoozedUntil: null }),
                  }).catch(() => {});
                  setMenuId(null);
                }}
              >
                Unsnooze
              </MenuRow>
            )}
            {snoozePresets().map((p) => (
              <MenuRow
                key={p.label}
                icon={<ClockIcon className="h-4 w-4" />}
                onClick={() => {
                  snooze(c, p.date);
                  setMenuId(null);
                }}
              >
                {p.label}
              </MenuRow>
            ))}

            <div className="my-1 h-px bg-slate-100 dark:bg-neutral-700" />
            <MenuRow
              icon={<PinIcon className="h-4 w-4" />}
              onClick={() => {
                togglePin(c);
                setMenuId(null);
              }}
            >
              {c.pinned ? "Unpin" : "Pin to top"}
            </MenuRow>
            <MenuRow
              icon={
                c.hidden ? (
                  <EyeIcon className="h-4 w-4" />
                ) : (
                  <EyeOffIcon className="h-4 w-4" />
                )
              }
              onClick={() => {
                toggleHide(c);
                setMenuId(null);
              }}
            >
              {c.hidden ? "Unhide" : "Hide (not a client)"}
            </MenuRow>

            <div className="my-1 h-px bg-slate-100 dark:bg-neutral-700" />
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              Add to folder
            </div>
            {folders.length === 0 && (
              <div className="px-2.5 py-1 text-xs text-slate-400 dark:text-neutral-500">
                No folders yet
              </div>
            )}
            {folders.map((f) => {
              const inFolder = c.folderIds.includes(f.id);
              return (
                <MenuRow
                  key={f.id}
                  icon={<FolderIcon className="h-4 w-4" />}
                  active={inFolder}
                  trailing={
                    inFolder ? (
                      <CheckIcon className="h-4 w-4 text-accent" />
                    ) : undefined
                  }
                  onClick={() => toggleFolder(c, f.id)}
                >
                  {f.name}
                </MenuRow>
              );
            })}
            <MenuRow
              icon={<PlusIcon className="h-4 w-4" />}
              className="text-accent dark:text-accent"
              onClick={() => {
                openNewFolder(c.id);
                setMenuId(null);
              }}
            >
              New folder
            </MenuRow>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-white dark:bg-neutral-900">
      {/* Top-right controls — match the Board's placement */}
      <div className="absolute right-3 top-2.5 z-30 flex items-center gap-1">
        {selected && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowContact((v) => !v)}
            title={showContact ? "Hide contact info" : "Show contact info"}
            className={`grid h-9 w-9 place-items-center rounded-xl border transition-colors ${
              showContact
                ? "border-accent/40 bg-accent/15 text-accent dark:border-accent/30 dark:bg-accent/15 dark:text-accent"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            <InfoIcon className="h-[18px] w-[18px]" />
          </motion.button>
        )}
        <ThemeToggle />
      </div>

      {/* Conversation list */}
      <div className="flex w-96 shrink-0 flex-col border-r border-slate-200 dark:border-neutral-800">
        <div className="border-b border-slate-200 px-4 pb-3 pt-4 dark:border-neutral-800">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(true)}
                title="Settings"
                className="rounded-lg transition hover:opacity-75"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/icon-light.png" alt="Settings" className="h-6 w-6 dark:hidden" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/icon-dark.png" alt="Settings" className="hidden h-6 w-6 dark:block" />
              </button>
              <nav className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-neutral-800">
                <span className="rounded-md bg-white px-2.5 py-1 text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100">
                  Inbox
                </span>
                <Link
                  href="/board"
                  className="rounded-md px-2.5 py-1 text-slate-500 transition hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  Board
                </Link>
                <Link
                  href="/automations"
                  className="rounded-md px-2.5 py-1 text-slate-500 transition hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  Auto
                </Link>
              </nav>
            </div>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowConnections(true)}
              title="Connections"
              className="relative rounded-full p-2 text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <LinkIcon className="h-4 w-4" />
              <motion.span
                className="absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-white dark:ring-neutral-900"
                style={{ backgroundColor: connDot }}
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.button>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="group mb-3 flex w-full items-center gap-2.5 rounded-lg bg-slate-100 py-2 pl-3 pr-2.5 text-sm text-slate-400 transition hover:bg-slate-200/70 dark:bg-neutral-800 dark:text-neutral-500 dark:hover:bg-neutral-700/70"
          >
            <SearchIcon className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Search chats…</span>
            <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 shadow-sm dark:bg-neutral-900 dark:text-neutral-500">
              ⌘K
            </kbd>
          </button>

          {/* Status / lifecycle views */}
          {!showHidden && (
            <div className="scroll-thin mb-2.5 flex items-center gap-1 overflow-x-auto pb-0.5">
              {(
                [
                  ["all", "All"],
                  ["needsreply", "Needs reply"],
                  ["cold", "Cold"],
                  ["snoozed", "Snoozed"],
                  ["done", "Done"],
                ] as [InboxView, string][]
              ).map(([id, label]) => (
                <motion.button
                  key={id}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setView(id)}
                  className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    view === id
                      ? "bg-slate-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  {label}
                  {viewCounts[id] > 0 && (
                    <span
                      className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                        view === id
                          ? "bg-white/20 text-white dark:bg-neutral-900/15 dark:text-neutral-900"
                          : id === "cold"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                          : "bg-slate-200 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300"
                      }`}
                    >
                      {viewCounts[id]}
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
          )}

          {/* Folder tabs + filter popover + hidden */}
          <div className="flex items-center gap-1.5">
            <div className="scroll-thin -mb-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1">
              <SegTab
                active={folderFilter === "all" && !showHidden}
                onClick={() => {
                  setFolderFilter("all");
                  setShowHidden(false);
                }}
              >
                All
              </SegTab>
              {folders.map((f) => (
                <SegTab
                  key={f.id}
                  active={folderFilter === f.id && !showHidden}
                  onClick={() => {
                    setShowHidden(false);
                    setFolderFilter((cur) => (cur === f.id ? "all" : f.id));
                  }}
                >
                  {f.name}
                </SegTab>
              ))}
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={() => openNewFolder(null)}
                title="New folder"
                className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </motion.button>
            </div>

            <div className="relative shrink-0">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowFilters((v) => !v)}
                title="Filter by platform & tag"
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                  activeFilters || showFilters
                    ? "bg-accent/15 text-accent dark:bg-accent/15 dark:text-accent"
                    : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                <FunnelIcon className="h-3.5 w-3.5" />
                {activeFilters > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
                    {activeFilters}
                  </span>
                )}
              </motion.button>

              <AnimatePresence>
                {showFilters && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowFilters(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -6 }}
                      transition={{ duration: 0.14, ease: "easeOut" }}
                      className="absolute right-0 top-full z-20 mt-1.5 w-64 origin-top-right rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                    >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                        Platform
                      </span>
                      {activeFilters > 0 && (
                        <button
                          onClick={() => {
                            setPlatformFilter("all");
                            setTagFilter("all");
                          }}
                          className="text-[11px] font-medium text-accent hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        onClick={() => setPlatformFilter("all")}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                          platformFilter === "all"
                            ? "bg-slate-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
                        }`}
                      >
                        All
                      </motion.button>
                      {PLATFORM_ORDER.map((p) => (
                        <motion.button
                          key={p}
                          whileTap={{ scale: 0.88 }}
                          onClick={() =>
                            setPlatformFilter((cur) => (cur === p ? "all" : p))
                          }
                          title={PLATFORMS[p].label}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                            platformFilter === p
                              ? "text-white"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
                          }`}
                          style={
                            platformFilter === p
                              ? { backgroundColor: PLATFORMS[p].bg }
                              : undefined
                          }
                        >
                          <PlatformGlyph platform={p} className="h-3.5 w-3.5" />
                        </motion.button>
                      ))}
                    </div>
                    {tags.length > 0 && (
                      <>
                        <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                          Tag
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map((t) => (
                            <motion.button
                              key={t.id}
                              whileTap={{ scale: 0.92 }}
                              onClick={() =>
                                setTagFilter((cur) =>
                                  cur === t.id ? "all" : t.id
                                )
                              }
                              className="rounded-full px-2.5 py-1 text-xs font-medium transition"
                              style={
                                tagFilter === t.id
                                  ? { backgroundColor: t.color, color: "white" }
                                  : {
                                      color: t.color,
                                      backgroundColor: `${t.color}1a`,
                                    }
                              }
                            >
                              {t.name}
                            </motion.button>
                          ))}
                        </div>
                      </>
                    )}
                  </motion.div>
                </>
              )}
              </AnimatePresence>
            </div>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setShowHidden((v) => !v);
                setFolderFilter("all");
              }}
              title="Hidden / not-a-client chats"
              className={`shrink-0 rounded-lg p-1.5 transition ${
                showHidden
                  ? "bg-slate-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                  : "text-slate-400 hover:bg-slate-100 dark:text-neutral-500 dark:hover:bg-neutral-800"
              }`}
            >
              <EyeOffIcon className="h-4 w-4" />
            </motion.button>
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">
              No conversations match.
            </div>
          )}
          {menuId && (
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuId(null)}
            />
          )}

          {/* Pinned chats — Apple Messages-style avatar grid */}
          {pinned.length > 0 && (
            <div className="grid grid-cols-3 gap-1 border-b border-slate-100 px-2 py-3 dark:border-neutral-800/70">
              {pinned.map((c) => (
                <div key={c.id} className="group relative flex flex-col items-center">
                  <motion.button
                    layout
                    whileTap={{ scale: 0.94 }}
                    onClick={() => selectConversation(c.id)}
                    className="flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition hover:bg-slate-50 dark:hover:bg-neutral-800/50"
                  >
                    <span
                      className={`relative rounded-full transition ${
                        c.id === selectedId
                          ? "ring-2 ring-accent ring-offset-2 ring-offset-white dark:ring-offset-neutral-900"
                          : ""
                      }`}
                    >
                      <Avatar
                        name={c.contact.name}
                        platform={c.platform}
                        size="lg"
                        src={c.contact.avatarUrl}
                      />
                      {c.unread > 0 && (
                        <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg ring-2 ring-white dark:ring-neutral-900">
                          {c.unread}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate text-xs font-medium text-slate-700 dark:text-neutral-300">
                      {c.contact.name.split(" ")[0]}
                    </span>
                  </motion.button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId((m) => (m === c.id ? null : c.id));
                    }}
                    className="absolute left-2 top-1 hidden rounded-full bg-white/90 p-1 text-slate-500 shadow-sm group-hover:block dark:bg-neutral-700/90 dark:text-neutral-300"
                    aria-label="Chat options"
                  >
                    <MoreIcon className="h-3.5 w-3.5" />
                  </button>
                  {convActionsMenu(c, "left-2 top-full mt-1 origin-top-left")}
                </div>
              ))}
            </div>
          )}

          {rest.map((c) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              onClick={() => selectConversation(c.id)}
              className={`group relative flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors dark:border-neutral-800/70 ${
                c.id === selectedId
                  ? "bg-accent/15 dark:bg-accent/10"
                  : "hover:bg-slate-50 dark:hover:bg-neutral-800/60"
              }`}
            >
              <Avatar
                name={c.contact.name}
                platform={c.platform}
                size="md"
                src={c.contact.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900 dark:text-neutral-100">
                    {c.status !== "done" && !isSnoozed(c) && (
                      <span
                        title={
                          c.lastDirection === "out"
                            ? "Waiting on them"
                            : "Needs reply"
                        }
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          c.lastDirection === "out"
                            ? "bg-sky-400 dark:bg-sky-500"
                            : "bg-amber-500"
                        }`}
                      />
                    )}
                    <span className="truncate">{c.contact.name}</span>
                    {dupAccountTag(c) && (
                      <span
                        title={`via ${c.account?.label}`}
                        className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-medium text-accent dark:text-accent"
                      >
                        {dupAccountTag(c)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400 group-hover:hidden dark:text-neutral-500">
                    {isSnoozed(c) && (
                      <span className="flex items-center gap-0.5 text-accent dark:text-accent">
                        <ClockIcon className="h-3 w-3" />
                        {snoozeLabel(c.snoozedUntil!)}
                      </span>
                    )}
                    {listTime(c.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-neutral-400">
                    {c.lastMessage}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {c.status !== "done" &&
                      !isSnoozed(c) &&
                      coldDays(c) >= settings.coldDays && (
                        <span
                          title={`Untouched for ${coldDays(c)} days`}
                          className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold leading-none text-amber-700 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-300"
                        >
                          <ClockIcon className="h-3 w-3" />
                          {coldDays(c)}d
                        </span>
                      )}
                    {c.unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
                {c.contact.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.contact.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ color: t.color, backgroundColor: `${t.color}1a` }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Hover ⋯ menu */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId((m) => (m === c.id ? null : c.id));
                }}
                className="absolute right-2 top-2 hidden rounded p-1 text-slate-500 hover:bg-slate-200 group-hover:block dark:text-neutral-400 dark:hover:bg-neutral-700"
                aria-label="Chat options"
              >
                ⋯
              </button>

              {convActionsMenu(c, "right-2 top-9 origin-top-right")}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1">
        {selected ? (
          <ChatThread
            key={selected.id}
            conversation={selected}
            snippets={snippets}
            onManageSnippets={() => setShowSnippets(true)}
            onSent={(preview) => handleSent(selected.id, preview)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-neutral-500">
            Select a conversation
          </div>
        )}
      </div>

      {/* CRM panel — hidden until opened via the info button */}
      <AnimatePresence>
        {selected && showContact && (
          <ContactPanel
            key={selected.contact.id}
            conversation={selected}
            allTags={tags}
            conversations={conversations}
            onSelectConversation={selectConversation}
            onContactChanged={handleContactChanged}
            onTagsChanged={handleTagsChanged}
            onTagCreated={(tag) =>
              setTags((ts) =>
                ts.some((t) => t.id === tag.id) ? ts : [...ts, tag]
              )
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConnections && (
          <ConnectionsModal
            data={connections}
            onClose={() => setShowConnections(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showSnippets && (
          <SnippetsModal
            snippets={snippets}
            onChange={setSnippets}
            onClose={() => setShowSnippets(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {paletteOpen && (
          <CommandPalette
            conversations={conversations}
            folders={folders}
            onClose={() => setPaletteOpen(false)}
            onOpenChat={(id) => {
              setShowHidden(false);
              selectConversation(id);
            }}
            onAddToFolder={addConvsToFolder}
            onCreateFolder={createFolderReturning}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {newFolderOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setNewFolderOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent dark:bg-accent/15 dark:text-accent">
                  <FolderIcon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                    New folder
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Group chats to find them fast
                  </p>
                </div>
              </div>
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNewFolder();
                  if (e.key === "Escape") setNewFolderOpen(false);
                }}
                placeholder="e.g. Clients, Leads, Partners…"
                className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-accent/40 dark:bg-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-700 dark:focus:ring-accent/40"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setNewFolderOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={submitNewFolder}
                  disabled={!newFolderName.trim()}
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg transition hover:bg-accent disabled:opacity-40"
                >
                  Create
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuRow({
  icon,
  trailing,
  active,
  onClick,
  className = "",
  children,
}: {
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-neutral-700 ${
        className ||
        (active
          ? "text-slate-900 dark:text-neutral-100"
          : "text-slate-700 dark:text-neutral-300")
      }`}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </motion.button>
  );
}

function SegTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-slate-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </motion.button>
  );
}

