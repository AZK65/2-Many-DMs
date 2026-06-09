"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { ConversationDTO, FolderDTO, TagDTO } from "@/lib/types";
import {
  PLATFORM_ORDER,
  PLATFORMS,
  type Platform,
} from "@/lib/platforms";
import { listTime } from "@/lib/time";
import { Avatar } from "./Avatar";
import { ChatThread } from "./ChatThread";
import { ContactPanel } from "./ContactPanel";
import { PlatformGlyph } from "./PlatformIcon";
import {
  ConnectionsModal,
  type ConnectionsData,
} from "./ConnectionsModal";
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FunnelIcon,
  LinkIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
} from "./icons";

export function Inbox() {
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [tags, setTags] = useState<TagDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [tagFilter, setTagFilter] = useState<string | "all">("all");
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | "all">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingFolderConvId, setPendingFolderConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnectionsData | null>(null);
  const [showConnections, setShowConnections] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/conversations").then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
      fetch("/api/folders").then((r) => r.json()),
    ]).then(([convs, tg, fl]: [ConversationDTO[], TagDTO[], FolderDTO[]]) => {
      setConversations(convs);
      setTags(tg);
      setFolders(fl);
      setSelectedId((cur) => cur ?? convs[0]?.id ?? null);
      setLoading(false);
    });
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

  const filtered = useMemo(() => {
    return conversations
      .filter((c) => {
        // Hidden ("not a client") chats only show in the Hidden view.
        if (showHidden ? !c.hidden : c.hidden) return false;
        if (folderFilter !== "all" && !c.folderIds.includes(folderFilter))
          return false;
        if (platformFilter !== "all" && c.platform !== platformFilter)
          return false;
        if (
          tagFilter !== "all" &&
          !c.contact.tags.some((t) => t.id === tagFilter)
        )
          return false;
        if (query) {
          const q = query.toLowerCase();
          const hay = `${c.contact.name} ${c.contact.handle} ${
            c.lastMessage ?? ""
          }`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Pinned first, then most-recent.
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime()
        );
      });
  }, [conversations, platformFilter, tagFilter, folderFilter, showHidden, query]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  function selectConversation(id: string) {
    setSelectedId(id);
    setConversations((cs) =>
      cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    );
  }

  function handleSent(convId: string, preview: string) {
    setConversations((cs) =>
      cs
        .map((c) =>
          c.id === convId
            ? { ...c, lastMessage: preview, lastMessageAt: new Date().toISOString() }
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

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      {/* Conversation list */}
      <div className="flex w-96 shrink-0 flex-col border-r border-slate-200">
        <div className="border-b border-slate-200 px-4 pb-3 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-slate-900">
                OmniCRM
              </h1>
              <nav className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                <span className="rounded-md bg-white px-2.5 py-1 text-slate-800 shadow-sm">
                  Inbox
                </span>
                <Link
                  href="/board"
                  className="rounded-md px-2.5 py-1 text-slate-500 transition hover:text-slate-800"
                >
                  Board
                </Link>
              </nav>
            </div>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowConnections(true)}
              title="Connections"
              className="relative rounded-full p-2 text-slate-500 transition hover:bg-slate-100"
            >
              <LinkIcon className="h-4 w-4" />
              <motion.span
                className="absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-white"
                style={{ backgroundColor: connDot }}
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.button>
          </div>

          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-lg bg-slate-100 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200"
            />
          </div>

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
                className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
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
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <FunnelIcon className="h-3.5 w-3.5" />
                {activeFilters > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
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
                      className="absolute right-0 top-full z-20 mt-1.5 w-64 origin-top-right rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
                    >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Platform
                      </span>
                      {activeFilters > 0 && (
                        <button
                          onClick={() => {
                            setPlatformFilter("all");
                            setTagFilter("all");
                          }}
                          className="text-[11px] font-medium text-blue-600 hover:underline"
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
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
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
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
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
                        <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-100"
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
          {filtered.map((c) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              onClick={() => selectConversation(c.id)}
              className={`group relative flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors ${
                c.id === selectedId ? "bg-blue-50" : "hover:bg-slate-50"
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
                  <span className="flex min-w-0 items-center gap-1 font-semibold text-slate-900">
                    {c.pinned && <span title="Pinned">📌</span>}
                    <span className="truncate">{c.contact.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400 group-hover:hidden">
                    {listTime(c.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-slate-500">
                    {c.lastMessage}
                  </span>
                  {c.unread > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                      {c.unread}
                    </span>
                  )}
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
                className="absolute right-2 top-2 hidden rounded p-1 text-slate-500 hover:bg-slate-200 group-hover:block"
                aria-label="Chat options"
              >
                ⋯
              </button>

              <AnimatePresence>
              {menuId === c.id && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.13, ease: "easeOut" }}
                  className="absolute right-2 top-9 z-20 w-60 origin-top-right rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MenuRow
                    icon={<PinIcon className="h-4 w-4" />}
                    onClick={() => { togglePin(c); setMenuId(null); }}
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
                    onClick={() => { toggleHide(c); setMenuId(null); }}
                  >
                    {c.hidden ? "Unhide" : "Hide (not a client)"}
                  </MenuRow>

                  <div className="my-1 h-px bg-slate-100" />
                  <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Add to folder
                  </div>
                  {folders.length === 0 && (
                    <div className="px-2.5 py-1 text-xs text-slate-400">
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
                            <CheckIcon className="h-4 w-4 text-blue-600" />
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
                    className="text-blue-600"
                    onClick={() => { openNewFolder(c.id); setMenuId(null); }}
                  >
                    New folder
                  </MenuRow>
                </motion.div>
              )}
              </AnimatePresence>
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
            onSent={(preview) => handleSent(selected.id, preview)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Select a conversation
          </div>
        )}
      </div>

      {/* CRM panel */}
      {selected && (
        <ContactPanel
          key={selected.contact.id}
          conversation={selected}
          allTags={tags}
          onTagsChanged={handleTagsChanged}
          onTagCreated={(tag) =>
            setTags((ts) =>
              ts.some((t) => t.id === tag.id) ? ts : [...ts, tag]
            )
          }
        />
      )}

      <AnimatePresence>
        {showConnections && (
          <ConnectionsModal
            data={connections}
            onClose={() => setShowConnections(false)}
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
              className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <FolderIcon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    New folder
                  </h3>
                  <p className="text-xs text-slate-500">
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
                className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-200"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setNewFolderOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={submitNewFolder}
                  disabled={!newFolderName.trim()}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
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
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-slate-100 ${
        className || (active ? "text-slate-900" : "text-slate-700")
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
          ? "bg-slate-900 text-white"
          : "text-slate-500 hover:bg-slate-100"
      }`}
    >
      {children}
    </motion.button>
  );
}

