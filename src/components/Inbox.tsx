"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type {
  ConversationDTO,
  ConversationAppearanceDTO,
  ConversationPollDTO,
  FolderDTO,
  KeywordAlertDTO,
  KeywordNotificationDTO,
  SnippetDTO,
  TagDTO,
} from "@/lib/types";
import {
  PLATFORM_ORDER,
  PLATFORMS,
  type Platform,
} from "@/lib/platforms";
import { inboxDateTime, snoozeLabel } from "@/lib/time";
import { fetchJson, parseJsonResponse } from "@/lib/fetch-json";
import { Avatar } from "./Avatar";
import {
  ChatThread,
  prefetchConversationMessages,
  type TaggedPersonTarget,
} from "./ChatThread";
import { ContactPanel } from "./ContactPanel";
import { PlatformGlyph } from "./PlatformIcon";
import { ChatTypeIcon } from "./ChatTypeIcon";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { OverlayPortal } from "./OverlayPortal";
import { SettingsModal } from "./SettingsModal";
import { ChatAssistant } from "./ChatAssistant";
import { CreateGroupModal } from "./CreateGroupModal";
import {
  NewMessageModal,
  type NewMessageRecipient,
} from "./NewMessageModal";
import {
  DRAFT_CHANGED_EVENT,
  loadConversationDrafts,
  type ConversationDrafts,
} from "@/lib/drafts";
import {
  loadSettings,
  applySettings,
  DEFAULT_SETTINGS,
  type Settings,
} from "@/lib/settings";
import { SnippetsModal } from "./SnippetsModal";
import { CommandPalette } from "./CommandPalette";
import { EmailHistory } from "./EmailHistory";
import { TodoTray } from "./TodoTray";

import type { ConnectionsData } from "./ConnectionsModal";
import { chatSyncIssue, type SyncStatus } from "@/lib/sync-health";
import { matchesChatKind, needsReply, type ChatKind } from "@/lib/inbox-triage";
import { NotificationCenter } from "./NotificationCenter";
import { SyncRestartControl } from "./SyncRestartControl";
import {
  ArchiveIcon,
  AtSignIcon,
  BellIcon,
  CloseIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FunnelIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
  SidebarIcon,
  SortIcon,
} from "./icons";

type InboxView =
  | "all"
  | "needsreply"
  | "followups"
  | "cold"
  | "requests"
  | "snoozed"
  | "archived"
  | "done";

type IntentFilter = ConversationDTO["intent"] | "all";
type ReplyAgeFilter =
  | "all"
  | "today"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "week"
  | "older";
type ReplySort = "newest" | "longest";

const MULTI_VIEW_STORAGE_KEY = "omnicrm-multi-view-pinned";
const SIDEBAR_STORAGE_KEY = "omnicrm-inbox-collapsed";
const REPLY_QUEUE_GRACE_MS = 3 * 60 * 1000;
const REPLY_AGE_OPTIONS: Array<{ id: ReplyAgeFilter; label: string }> = [
  { id: "all", label: "Any wait" },
  { id: "today", label: "Today" },
  { id: "1", label: "Waiting 1 day" },
  { id: "2", label: "Waiting 2 days" },
  { id: "3", label: "Waiting 3 days" },
  { id: "4", label: "Waiting 4 days" },
  { id: "5", label: "Waiting 5 days" },
  { id: "week", label: "Waiting 6–7 days" },
  { id: "older", label: "Over a week" },
];

type IncomingNotice = {
  conversationId: string;
  name: string;
  preview: string;
  platform: Platform;
  keywordNotification: KeywordNotificationDTO | null;
};

type ActionNotice = {
  tone: "success" | "error";
  message: string;
  undoConversationId?: string;
};

const INTENTS: Record<
  ConversationDTO["intent"],
  { label: string; color: string; bg: string }
> = {
  prospect: { label: "Prospect", color: "#7c3aed", bg: "#ede9fe" },
  onboarding: { label: "Onboarding", color: "#2563eb", bg: "#dbeafe" },
  support: { label: "Support", color: "#d97706", bg: "#fef3c7" },
  normal: { label: "Normal", color: "#64748b", bg: "#f1f5f9" },
};

function isSnoozed(c: ConversationDTO): boolean {
  return !!c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now();
}

function compactCount(count: number): string {
  if (count < 1_000) return count.toLocaleString();
  if (count < 1_000_000) {
    const thousands = Math.round(count / 100) / 10;
    return `${thousands.toFixed(Number.isInteger(thousands) ? 0 : 1)}k`;
  }
  const millions = Math.round(count / 100_000) / 10;
  return `${millions.toFixed(Number.isInteger(millions) ? 0 : 1)}m`;
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

function calendarDaysAgo(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  return Math.max(0, Math.round((today - messageDay) / 86_400_000));
}

function matchesReplyAge(
  conversation: ConversationDTO,
  filter: ReplyAgeFilter
): boolean {
  if (filter === "all") return true;
  const days = calendarDaysAgo(conversation.lastMessageAt);
  if (filter === "today") return days === 0;
  if (filter === "week") return days >= 6 && days <= 7;
  if (filter === "older") return days > 7;
  return days === Number(filter);
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

export function Inbox({ readOnly = false }: { readOnly?: boolean }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const conversationEtag = useRef<string | null>(null);
  const conversationIdsRef = useRef<Set<string>>(new Set());
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"); } catch { /* Preferences may be unavailable in private browsing. */ }
  }, []);
  function setSidebarCompact(compact: boolean) {
    setSidebarCollapsed(compact);
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(compact)); } catch { /* Keep the session preference without storage. */ }
    requestAnimationFrame(() => (compact ? expandButtonRef : collapseButtonRef).current?.focus());
  }
  const scrollAnchorsRef = useRef<Array<{ id: string; top: number }>>([]);
  const scrollScopeRef = useRef("");
  const rememberScrollAnchor = useCallback(() => {
    const list = inboxScrollRef.current;
    if (!list?.clientHeight) return;
    if (list.scrollTop < 4) { scrollAnchorsRef.current = []; return; }
    const top = list.getBoundingClientRect().top;
    scrollAnchorsRef.current = Array.from(list.querySelectorAll<HTMLElement>("[data-conversation-id]"))
      .filter(row => row.getBoundingClientRect().bottom > top)
      .slice(0, 5).map(row => ({ id: row.dataset.conversationId!, top: row.getBoundingClientRect().top - top }));
  }, []);
  const [tags, setTags] = useState<TagDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [tagFilter, setTagFilter] = useState<string | "all">("all");
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all");
  const [replyAgeFilter, setReplyAgeFilter] =
    useState<ReplyAgeFilter>("all");
  const [replySort, setReplySort] = useState<ReplySort>("newest");
  const [openedUnansweredOnly, setOpenedUnansweredOnly] = useState(false);
  const [chatKind, setChatKind] = useState<ChatKind>("all");
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [historyIssuesOnly, setHistoryIssuesOnly] = useState(false);
  const [connectionAccounts, setConnectionAccounts] = useState<Array<SyncStatus & { accountId: string }>>([]);
  const connectionFor = useCallback((c: ConversationDTO) => connectionAccounts.find(a => a.accountId === c.account?.id), [connectionAccounts]);
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | "all">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useState<InboxView>("needsreply");
  const [visibleCount, setVisibleCount] = useState(80);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [keywordAlerts, setKeywordAlerts] = useState<KeywordAlertDTO[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const initialNavigationApplied = useRef(false);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);

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

  useEffect(() => {
    const loadKeywordAlerts = () => {
      fetch("/api/keyword-alerts", { cache: "no-store" })
        .then((response) =>
          parseJsonResponse<KeywordAlertDTO[]>(response, "Keyword alerts"),
        )
        .then(setKeywordAlerts)
        .catch(() => {});
    };
    loadKeywordAlerts();
    window.addEventListener(
      "omnicrm-keyword-alerts-changed",
      loadKeywordAlerts,
    );
    return () =>
      window.removeEventListener(
        "omnicrm-keyword-alerts-changed",
        loadKeywordAlerts,
      );
  }, []);
  const [showFilters, setShowFilters] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showFilters) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShowFilters(false); filterTriggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [showFilters]);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingFolderConvId, setPendingFolderConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const workerStartAttempted = useRef(false);
  // Contact CRM panel is hidden until the user opens it for the current chat.
  const [showContact, setShowContact] = useState(false);
  const [snippets, setSnippets] = useState<SnippetDTO[]>([]);
  const [showSnippets, setShowSnippets] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [newMessageRecipient, setNewMessageRecipient] =
    useState<NewMessageRecipient | null>(null);
  const [drafts, setDrafts] = useState<ConversationDrafts>({});
  const [showEmails, setShowEmails] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [switchingToId, setSwitchingToId] = useState<string | null>(null);
  const [multiViewPinnedId, setMultiViewPinnedId] = useState<string | null>(null);
  const [multiViewHydrated, setMultiViewHydrated] = useState(false);
  const [mobileMultiPane, setMobileMultiPane] = useState<"pinned" | "browse">(
    "pinned"
  );
  const [incomingNotice, setIncomingNotice] = useState<IncomingNotice | null>(
    null
  );
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [contactConversationId, setContactConversationId] = useState<
    string | null
  >(null);
  const [heldQueueViewById, setHeldQueueViewById] = useState<
    Partial<Record<string, "needsreply" | "requests">>
  >({});
  const replyQueueReleaseTimersRef = useRef<Map<string, number>>(new Map());
  const heldQueueSortAtRef = useRef<Map<string, number>>(new Map());
  const selectionRequestRef = useRef(0);

  const conversationListSortAt = useCallback(
    (conversation: ConversationDTO) =>
      heldQueueSortAtRef.current.get(conversation.id) ??
      new Date(conversation.lastMessageAt).getTime(),
    []
  );

  useEffect(() => {
    const timers = replyQueueReleaseTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      heldQueueSortAtRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const refreshDrafts = () => setDrafts(loadConversationDrafts());
    refreshDrafts();
    window.addEventListener(DRAFT_CHANGED_EVENT, refreshDrafts);
    window.addEventListener("storage", refreshDrafts);
    return () => {
      window.removeEventListener(DRAFT_CHANGED_EVENT, refreshDrafts);
      window.removeEventListener("storage", refreshDrafts);
    };
  }, []);

  useEffect(() => {
    try {
      setMultiViewPinnedId(localStorage.getItem(MULTI_VIEW_STORAGE_KEY));
    } catch {}
    setMultiViewHydrated(true);
  }, []);

  useEffect(() => {
    if (!multiViewHydrated) return;
    try {
      if (multiViewPinnedId)
        localStorage.setItem(MULTI_VIEW_STORAGE_KEY, multiViewPinnedId);
      else localStorage.removeItem(MULTI_VIEW_STORAGE_KEY);
    } catch {}
  }, [multiViewHydrated, multiViewPinnedId]);

  useEffect(() => {
    if (!incomingNotice) return;
    const timer = window.setTimeout(() => setIncomingNotice(null), 10000);
    return () => window.clearTimeout(timer);
  }, [incomingNotice]);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = window.setTimeout(() => setActionNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  // First-run: send new users to the onboarding screen.
  useEffect(() => {
    try {
      if (!localStorage.getItem("onboarded")) router.replace("/welcome");
    } catch {}
  }, [router]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [conversationResult, tagResult, folderResult, snippetResult] =
      await Promise.allSettled([
        fetch("/api/conversations", { cache: "no-store" }).then((response) => {
          conversationEtag.current = response.headers.get("etag");
          return parseJsonResponse<ConversationDTO[]>(response, "Conversations");
        }),
        fetchJson<TagDTO[]>("/api/tags", { cache: "no-store" }, "Tags"),
        fetchJson<FolderDTO[]>("/api/folders", { cache: "no-store" }, "Folders"),
        fetchJson<SnippetDTO[]>("/api/snippets", { cache: "no-store" }, "Snippets"),
      ]);

    if (conversationResult.status === "rejected") {
      const reason = conversationResult.reason;
      setLoadError(
        reason instanceof Error ? reason.message : "Conversations could not be loaded."
      );
      setLoading(false);
      return;
    }

    const convs = conversationResult.value;
    conversationIdsRef.current = new Set(convs.map((conversation) => conversation.id));
    setConversations(convs);
    if (tagResult.status === "fulfilled") setTags(tagResult.value);
    else console.warn("Tags could not be loaded", tagResult.reason);
    if (folderResult.status === "fulfilled") setFolders(folderResult.value);
    else console.warn("Folders could not be loaded", folderResult.reason);
    if (snippetResult.status === "fulfilled") setSnippets(snippetResult.value);
    else console.warn("Snippets could not be loaded", snippetResult.reason);

    const params = new URLSearchParams(window.location.search);
    // A deep link initializes the workspace once. Background refreshes must
    // preserve the chat (or mobile list) the user has since chosen.
    const requested = initialNavigationApplied.current ? null : params.get("conversation");
    const requestedConversation =
      requested && convs.some((conversation) => conversation.id === requested)
        ? requested
        : null;
    const firstActiveConversation = convs.find(
      (conversation) =>
        !conversation.hidden &&
        !conversation.archived &&
        conversation.status !== "done"
    );
    setSelectedId(
      (current) =>
        requestedConversation ??
        current ??
        firstActiveConversation?.id ??
        null
    );
    if (requestedConversation) setMobileThreadOpen(true);
    if (requestedConversation && params.get("message")) setFocusMessageId(params.get("message"));
    if (requestedConversation && params.get("info") === "1") {
      setContactConversationId(requestedConversation);
      setShowContact(true);
    }
    initialNavigationApplied.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  // Photos can arrive after the initial sync. Refresh only presentation data;
  // never replace selection, unread counts, ordering, drafts, or scroll state.
  useEffect(() => {
    let etag: string | null = null;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const response = await fetch("/api/conversations?appearance=1", {
          signal: controller.signal,
          headers: etag ? { "If-None-Match": etag } : undefined,
        });
        if (response.status === 304) return;
        const updates = await parseJsonResponse<ConversationAppearanceDTO[]>(response, "Chat photos");
        etag = response.headers.get("etag");
        const byId = new Map(updates.map(update => [update.id, update]));
        setConversations(current => current.map(conversation => {
          const update = byId.get(conversation.id);
          if (!update) return conversation;
          return { ...conversation, groupPreview: update.groupPreview,
            contact: { ...conversation.contact, avatarUrl: update.avatarUrl } };
        }));
      } catch { /* Keep the last known photos if refresh is unavailable. */ }
      finally { pending = false; }
    };
    const timer = setInterval(() => void refresh(), 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Poll for new inbound messages synced by the worker. Selection lives in its
  // own state, so refreshing the list never changes which thread is open.
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/conversations?poll=1", {
        headers: conversationEtag.current
          ? { "If-None-Match": conversationEtag.current }
          : undefined,
      })
        .then((r) => {
          if (r.status === 304) return null;
          conversationEtag.current = r.headers.get("etag");
          return parseJsonResponse<ConversationPollDTO[]>(r, "Conversations");
        })
        .then((updates: ConversationPollDTO[] | null) => {
          if (!updates) return;
          setLoadError(null);

          // A newly synced conversation needs its contact/account metadata,
          // which is intentionally absent from the lightweight poll response.
          if (updates.some((update) => !conversationIdsRef.current.has(update.id))) {
            fetch("/api/conversations", { cache: "no-store" })
              .then((response) => {
                conversationEtag.current = response.headers.get("etag");
                return parseJsonResponse<ConversationDTO[]>(response, "Conversations");
              })
              .then((snapshot) => {
                conversationIdsRef.current = new Set(
                  snapshot.map((conversation) => conversation.id)
                );
                setConversations(snapshot);
                setLoadError(null);
              })
              .catch(() => {});
            return;
          }

          const byId = new Map(updates.map((update) => [update.id, update]));
          const order = new Map(updates.map((update, index) => [update.id, index]));
          conversationIdsRef.current = new Set(byId.keys());
          setConversations((current) =>
            current
              .filter((conversation) => byId.has(conversation.id))
              .map((conversation) => ({
                ...conversation,
                ...byId.get(conversation.id)!,
              }))
              .sort(
                (left, right) =>
                  (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                  (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
              )
          );
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!conversations.length) return;
    const likelyNext = conversations
      .filter(
        (conversation) =>
          !conversation.hidden &&
          !conversation.archived &&
          conversation.status !== "done"
      )
      .slice(0, 6)
      .map((conversation) => conversation.id);
    const prefetch = () => {
      for (const conversationId of likelyNext)
        void prefetchConversationMessages(conversationId);
    };

    const timer = window.setTimeout(prefetch, 500);
    return () => window.clearTimeout(timer);
  }, [conversations]);

  // Desktop notifications for new inbound messages, fired straight from this
  // open window — no service worker or push service involved, so they only
  // arrive while the app is running. Works by diffing unread counts per poll.
  const seenUnread = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!conversations.length) return;
    const prev = seenUnread.current;
    seenUnread.current = new Map(conversations.map((c) => [c.id, c.unread]));
    // The first load is only a baseline — without this, switching the setting on
    // would fire one notification per chat you already had unread.
    if (!prev) return;
    const incoming = conversations.filter(
      (conversation) =>
        !conversation.archived &&
        conversation.unread > (prev.get(conversation.id) ?? 0) &&
        conversation.id !== selectedId &&
        conversation.id !== multiViewPinnedId
    );
    const matchingKeyword = (conversation: ConversationDTO): string | null => {
      if (conversation.platform !== "telegram" || !conversation.isGroup)
        return null;
      const body = (conversation.lastMessage || "").toLocaleLowerCase();
      if (!body) return null;
      const rules = keywordAlerts.filter(
        (rule) =>
          rule.enabled &&
          (rule.conversationId === null || rule.conversationId === conversation.id),
      );
      for (const rule of rules) {
        const phrase = rule.phrases.find((candidate) =>
          body.includes(candidate.toLocaleLowerCase()),
        );
        if (phrase) return phrase;
      }
      return null;
    };
    // Keyword matches are handled by the durable notification feed below. Do
    // not also show the ordinary message popup for them or users receive two
    // alerts for the same Telegram message.
    const ordinaryIncoming = incoming.filter(
      (conversation) => !matchingKeyword(conversation),
    );
    const newest = ordinaryIncoming[0];
    if (newest) {
      setIncomingNotice({
        conversationId: newest.id,
        name: newest.contact.name,
        preview: newest.lastMessage || "New message",
        platform: newest.platform,
        keywordNotification: null,
      });
    }

    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) return;

    if (!settings.notifications) return;
    for (const c of ordinaryIncoming) {
      // Don't interrupt you about the chat you're already looking at.
      const n = new Notification(
        `${c.contact.name} · ${PLATFORMS[c.platform].label}`,
        {
          body: c.lastMessage || "New message",
          icon: c.contact.avatarUrl || "/icon-192.png",
          tag: c.id,
        }
      );
      n.onclick = () => {
        window.focus();
        addConversationToMultiView(c.id);
        n.close();
      };
    }
  }, [
    conversations,
    keywordAlerts,
    settings.notifications,
    selectedId,
    multiViewPinnedId,
  ]);

  // ⌘K / Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setShowCreateGroup(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the sync worker healthy even though account controls now live in
  // Settings rather than taking up a permanent inbox-header button.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      return fetch("/api/connections", { cache: "no-store", signal: AbortSignal.timeout(5000) })
        .then((r) => r.json())
        .then((d: ConnectionsData) => {
          if (cancelled) return;
          const accounts = (d.platforms as unknown as { accounts?: Array<SyncStatus & { accountId: string }> }).accounts;
          setConnectionAccounts(Array.isArray(accounts) ? accounts : []);
          if (d.workerRunning) {
            workerStartAttempted.current = false;
          } else if (!workerStartAttempted.current) {
            workerStartAttempted.current = true;
            fetch("/api/worker/start", { method: "POST" }).catch(() => {});
            window.setTimeout(() => {
              workerStartAttempted.current = false;
            }, 15000);
          }
        })
        .catch(() => { if (!cancelled) setConnectionAccounts([]); })
        .finally(() => { inFlight = false; });
    };
    load();
    const t = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(t); };
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
      if (intentFilter !== "all" && c.intent !== intentFilter) return false;
      if (!matchesChatKind(c, chatKind)) return false;
      if (mentionsOnly && !c.hasUnreadMention) return false;
      if (historyIssuesOnly && !c.previewOnly && !chatSyncIssue(c.externalId, connectionFor(c)?.sync)) return false;
      return true;
    });
  }, [conversations, platformFilter, tagFilter, intentFilter, folderFilter, showHidden, chatKind, mentionsOnly, historyIssuesOnly, connectionFor]);

  function matchesView(c: ConversationDTO, v: InboxView): boolean {
    const snoozed = isSnoozed(c);
    if (v === "archived") return c.archived;
    if (c.archived) return false;
    if (c.inboxCategory === "spam")
      return v === "requests" && c.status !== "done" && !snoozed;
    if (v === "requests") return false;
    if (v === "snoozed") return snoozed;
    if (v === "done") return c.status === "done";
    if (c.status === "done" || snoozed) return false;
    if (v === "all") return true; // every active (non-done, non-snoozed) chat
    if (v === "followups")
      return !!c.followUpAt && new Date(c.followUpAt).getTime() <= Date.now();
    // Reply is the actionable inbox: the latest message is theirs and has not
    // been answered. Unread counters can be stale after an outbound message,
    // so direction is the reliable source for this queue.
    if (v === "needsreply") return needsReply(c);
    if (v === "cold") return c.lastDirection === "out";
    return false;
  }

  const viewCounts = useMemo(() => {
    const counts: Record<InboxView, number> = {
      all: 0,
      needsreply: 0,
      followups: 0,
      cold: 0,
      requests: 0,
      snoozed: 0,
      archived: 0,
      done: 0,
    };
    for (const c of scoped)
      for (const v of [
        "all",
        "needsreply",
        "followups",
        "cold",
        "requests",
        "snoozed",
        "archived",
        "done",
      ] as InboxView[])
        if (heldQueueViewById[c.id] === v || matchesView(c, v)) counts[v]++;
    return counts;
  }, [scoped, heldQueueViewById]);

  function moveToGeneral(c: ConversationDTO) {
    patchConversation(c.id, { inboxCategory: "general" });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboxCategory: "general", inboxOverride: true }),
    }).catch(() => {});
  }

  const filtered = useMemo(() => {
    return scoped
      // Requests never leak into General views, including the hidden bucket.
      .filter((c) => {
        if (view === "needsreply" && openedUnansweredOnly) {
          const openedAt = c.lastOpenedAt
            ? new Date(c.lastOpenedAt).getTime()
            : 0;
          const latestAt = new Date(c.lastMessageAt).getTime();
          // Count a chat only when its current inbound message has actually
          // been opened in Omni. Opening an older version of the thread does
          // not make a newer incoming message "viewed".
          if (
            c.lastDirection !== "in" ||
            !openedAt ||
            !Number.isFinite(latestAt) ||
            openedAt < latestAt
          ) {
            return false;
          }
        }
        // A successfully replied chat stays here for a three-minute grace
        // period so another quick DM is easy. Leaving the chat or letting the
        // timer expire releases the hold; its real direction then takes over.
        if (heldQueueViewById[c.id] === view) return true;
        const matchesLifecycle = view === "requests"
          ? matchesView(c, view)
          : c.inboxCategory !== "spam" && (showHidden || matchesView(c, view));
        if (!matchesLifecycle) return false;
        return view !== "needsreply" || matchesReplyAge(c, replyAgeFilter);
      })
      .sort((a, b) => {
        if (view === "needsreply") {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          const newestFirst = replySort === "newest";
          const left = conversationListSortAt(a);
          const right = conversationListSortAt(b);
          return newestFirst ? right - left : left - right;
        }
        // Cold view: longest-waiting (stalest) first.
        if (view === "cold") return coldDays(b) - coldDays(a);
        if (view === "followups")
          return (
            new Date(a.followUpAt || 0).getTime() -
            new Date(b.followUpAt || 0).getTime()
          );
        // Otherwise pinned first, then most-recent.
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return conversationListSortAt(b) - conversationListSortAt(a);
      });
  }, [
    scoped,
    view,
    showHidden,
    heldQueueViewById,
    replyAgeFilter,
    replySort,
    openedUnansweredOnly,
    conversationListSortAt,
  ]);

  useEffect(
    () => setVisibleCount(80),
    [
      view,
      folderFilter,
      platformFilter,
      tagFilter,
      intentFilter,
      replyAgeFilter,
      replySort,
      openedUnansweredOnly,
      showHidden,
      chatKind,
      mentionsOnly,
      historyIssuesOnly,
    ]
  );

  // Keep the same visible row in place when replies, new messages, or history
  // repairs reorder/remove rows above it. Changing filters intentionally resets.
  const scrollScope = [view, folderFilter, platformFilter, tagFilter, intentFilter, replyAgeFilter, replySort, openedUnansweredOnly, showHidden, chatKind, mentionsOnly, historyIssuesOnly].join(":");
  useLayoutEffect(() => {
    const list = inboxScrollRef.current;
    if (!list?.clientHeight) return;
    if (scrollScopeRef.current !== scrollScope) {
      scrollScopeRef.current = scrollScope;
      scrollAnchorsRef.current = [];
      list.scrollTop = 0;
    } else {
      const rows = new Map(Array.from(list.querySelectorAll<HTMLElement>("[data-conversation-id]")).map(row => [row.dataset.conversationId, row]));
      const anchor = scrollAnchorsRef.current.find(item => rows.has(item.id));
      if (anchor) list.scrollTop += rows.get(anchor.id)!.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.top;
    }
    rememberScrollAnchor();
  }, [filtered, visibleCount, scrollScope, sidebarCollapsed, rememberScrollAnchor]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const multiViewPinned =
    conversations.find((conversation) => conversation.id === multiViewPinnedId) ??
    null;
  const contactConversation =
    conversations.find(
      (conversation) => conversation.id === contactConversationId
    ) ?? selected;
  const activeConversationId = switchingToId ?? selectedId;

  useEffect(() => {
    if (
      multiViewHydrated &&
      multiViewPinnedId &&
      conversations.length > 0 &&
      !multiViewPinned
    ) {
      setMultiViewPinnedId(null);
    }
  }, [conversations, multiViewHydrated, multiViewPinned, multiViewPinnedId]);

  useEffect(() => {
    if (multiViewPinnedId && selectedId === multiViewPinnedId) {
      setSelectedId(null);
    }
  }, [multiViewPinnedId, selectedId]);

  // Sibling topics of the open forum channel, shown as tabs in the thread.
  const selectedTopics = useMemo(() => {
    if (!selected?.topicOf) return undefined;
    return conversations
      .filter((c) => c.topicOf === selected.topicOf)
      .sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime()
      )
      .map((c) => ({
        id: c.id,
        name: c.contact.name.split(" · ").slice(1).join(" · ") || c.contact.name,
        unread: c.unread,
      }));
  }, [conversations, selected]);

  const multiViewPinnedTopics = useMemo(() => {
    if (!multiViewPinned?.topicOf) return undefined;
    return conversations
      .filter((conversation) => conversation.topicOf === multiViewPinned.topicOf)
      .sort(
        (left, right) =>
          new Date(right.lastMessageAt).getTime() -
          new Date(left.lastMessageAt).getTime()
      )
      .map((conversation) => ({
        id: conversation.id,
        name:
          conversation.contact.name.split(" · ").slice(1).join(" · ") ||
          conversation.contact.name,
        unread: conversation.unread,
      }));
  }, [conversations, multiViewPinned]);

  function releaseConversationFromQueue(id: string | null) {
    if (!id) return;
    heldQueueSortAtRef.current.delete(id);
    const timer = replyQueueReleaseTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      replyQueueReleaseTimersRef.current.delete(id);
    }
    setHeldQueueViewById((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function scheduleConversationReleaseFromQueue(id: string) {
    const currentTimer = replyQueueReleaseTimersRef.current.get(id);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);

    const timer = window.setTimeout(() => {
      replyQueueReleaseTimersRef.current.delete(id);
      heldQueueSortAtRef.current.delete(id);
      setHeldQueueViewById((current) => {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    }, REPLY_QUEUE_GRACE_MS);
    replyQueueReleaseTimersRef.current.set(id, timer);
  }

  function selectConversation(id: string) {
    if (id !== selectedId) {
      setShowContact(false);
      setContactConversationId(null);
    }
    if (id === multiViewPinnedId) {
      if (selectedId && selectedId !== id)
        releaseConversationFromQueue(selectedId);
      setFocusMessageId(null);
      setMobileMultiPane("pinned");
      setMobileThreadOpen(true);
      return;
    }
    if (selectedId && selectedId !== id)
      releaseConversationFromQueue(selectedId);
    const request = ++selectionRequestRef.current;
    setFocusMessageId(null);
    setSwitchingToId(id === selectedId ? null : id);
    const now = new Date().toISOString();
    setConversations((cs) =>
      cs.map((c) =>
        c.id === id
          ? { ...c, unread: 0, hasUnreadMention: false, lastOpenedAt: now }
          : c
      )
    );
    void prefetchConversationMessages(id).then(() => {
      if (selectionRequestRef.current !== request) return;
      setSelectedId(id);
      setSwitchingToId(null);
      setMobileThreadOpen(true);
      if (multiViewPinnedId) setMobileMultiPane("browse");
    });
  }

  function pinConversationInMultiView(id: string) {
    if (multiViewPinnedId && multiViewPinnedId !== id)
      releaseConversationFromQueue(multiViewPinnedId);
    setShowContact(false);
    setContactConversationId(null);
    setMultiViewPinnedId(id);
    setMobileMultiPane("pinned");
    setMobileThreadOpen(true);
    if (selectedId === id) setSelectedId(null);
    void prefetchConversationMessages(id);
  }

  function unpinMultiView() {
    const fallbackId = selectedId ?? multiViewPinnedId;
    if (selectedId && multiViewPinnedId && selectedId !== multiViewPinnedId)
      releaseConversationFromQueue(multiViewPinnedId);
    setMultiViewPinnedId(null);
    setMobileMultiPane("browse");
    if (fallbackId) setSelectedId(fallbackId);
  }

  function addConversationToMultiView(id: string) {
    setIncomingNotice(null);
    setShowHidden(false);
    setShowContact(false);
    setContactConversationId(null);
    if (id === multiViewPinnedId) {
      setMobileMultiPane("pinned");
      setMobileThreadOpen(true);
      return;
    }
    if (!multiViewPinnedId && selectedId && selectedId !== id) {
      setMultiViewPinnedId(selectedId);
    } else if (!multiViewPinnedId && !selectedId) {
      setMultiViewPinnedId(id);
      setMobileMultiPane("pinned");
      setMobileThreadOpen(true);
      return;
    }
    selectConversation(id);
    setMobileMultiPane("browse");
  }

  function openConversationNormally(id: string) {
    setIncomingNotice(null);
    if (multiViewPinnedId && multiViewPinnedId !== id)
      releaseConversationFromQueue(multiViewPinnedId);
    setMultiViewPinnedId(null);
    setMobileMultiPane("browse");
    selectConversation(id);
  }

  function openKeywordNotification(notification: KeywordNotificationDTO) {
    setIncomingNotice(null);
    if (!notification.readAt) {
      fetch("/api/keyword-alerts/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
      }).catch(() => {});
    }
    setShowHidden(false);
    setView("all");
    openConversationNormally(notification.conversationId);
    setFocusMessageId(notification.messageId);
  }

  function handleNewKeywordNotifications(
    notifications: KeywordNotificationDTO[],
  ) {
    const newest = notifications[0];
    if (!newest) return;
    setIncomingNotice({
      conversationId: newest.conversationId,
      name: newest.groupName,
      preview: newest.preview,
      platform: "telegram",
      keywordNotification: newest,
    });

    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) return;
    for (const notification of notifications) {
      const desktop = new Notification(
        `Keyword alert · ${notification.groupName}`,
        {
          body: `“${notification.matchedPhrase}” — ${notification.preview}`,
          icon: "/icon-192.png",
          tag: `keyword-${notification.messageId}`,
        },
      );
      desktop.onclick = () => {
        window.focus();
        openKeywordNotification(notification);
        desktop.close();
      };
    }
  }

  async function handleStartedConversation(conversationId: string) {
    const response = await fetch("/api/conversations", { cache: "no-store" });
    const refreshed = await parseJsonResponse<ConversationDTO[]>(
      response,
      "Conversations"
    );
    conversationIdsRef.current = new Set(
      refreshed.map((conversation) => conversation.id)
    );
    setConversations(refreshed);
    setShowHidden(false);
    setView("all");
    setMultiViewPinnedId(null);
    setMobileMultiPane("browse");
    setShowContact(false);
    setContactConversationId(null);
    setFocusMessageId(null);
    setSwitchingToId(null);
    heldQueueSortAtRef.current.clear();
    setHeldQueueViewById({});
    setSelectedId(conversationId);
    setMobileThreadOpen(true);
  }

  function openNewMessage(recipient?: TaggedPersonTarget) {
    setNewMessageRecipient(recipient || null);
    setShowNewMessage(true);
  }

  function closeNewMessage() {
    setShowNewMessage(false);
    setNewMessageRecipient(null);
  }

  function toggleContactFor(id: string) {
    if (showContact && contactConversationId === id) {
      setShowContact(false);
      return;
    }
    setContactConversationId(id);
    setShowContact(true);
  }

  function advanceAfterQueueRemoval(convId: string) {
    const currentIndex = filtered.findIndex(
      (conversation) => conversation.id === convId
    );
    if (currentIndex < 0) return;
    const remaining = filtered.filter(
      (conversation) => conversation.id !== convId
    );
    const next = remaining[Math.min(currentIndex, remaining.length - 1)];

    setShowContact(false);
    setContactConversationId(null);
    if (next) {
      selectConversation(next.id);
      return;
    }

    selectionRequestRef.current += 1;
    setSelectedId(null);
    setSwitchingToId(null);
    setFocusMessageId(null);
    if (multiViewPinnedId) setMobileMultiPane("pinned");
    else setMobileThreadOpen(false);
  }

  function handleSent(convId: string, preview: string) {
    const heldView =
      (selectedId === convId || multiViewPinnedId === convId) &&
      (view === "needsreply" || view === "requests")
        ? view
        : null;
    if (heldView) {
      if (!heldQueueSortAtRef.current.has(convId)) {
        const conversation = conversations.find(({ id }) => id === convId);
        if (conversation) {
          heldQueueSortAtRef.current.set(
            convId,
            new Date(conversation.lastMessageAt).getTime()
          );
        }
      }
      setHeldQueueViewById((current) => ({
        ...current,
        [convId]: heldView,
      }));
    }
    // Keep the replied chat handy for a short burst of follow-up messages.
    // Every successful outbound message resets the grace period. When it
    // expires, the real lastDirection decides whether the chat stays in Reply.
    scheduleConversationReleaseFromQueue(convId);

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
                followUpAt: null,
                // A successful reply accepts an X message request. Mirror the
                // worker update immediately so it leaves Requests without
                // waiting for the next inbox poll.
                inboxCategory:
                  c.inboxCategory === "spam"
                    ? ("general" as const)
                    : c.inboxCategory,
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

  function markDoneAndAdvance(c: ConversationDTO) {
    const shouldAdvance =
      selectedId === c.id &&
      filtered.some((conversation) => conversation.id === c.id);
    releaseConversationFromQueue(c.id);
    setStatus(c, "done");
    if (shouldAdvance) advanceAfterQueueRemoval(c.id);
  }

  async function setArchivedAndMuted(
    c: ConversationDTO,
    archived: boolean
  ): Promise<void> {
    if (archivePendingId) return;
    const shouldAdvance =
      selectedId === c.id &&
      filtered.some((conversation) => conversation.id === c.id);
    setArchivePendingId(c.id);
    setActionNotice(null);
    setIncomingNotice(null);

    try {
      await fetchJson<{ ok: true; archived: boolean }>(
        `/api/conversations/${c.id}/archive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        },
        archived ? "Archive and mute" : "Restore chat"
      );

      releaseConversationFromQueue(c.id);
      patchConversation(c.id, {
        archived,
        status: archived ? "done" : "open",
        snoozedUntil: null,
        followUpAt: null,
      });
      if (archived && multiViewPinnedId === c.id) {
        setMultiViewPinnedId(null);
        setMobileMultiPane("browse");
      }
      if (shouldAdvance) advanceAfterQueueRemoval(c.id);

      setActionNotice({
        tone: "success",
        message: archived
          ? `Archived and muted on ${PLATFORMS[c.platform].label}.`
          : `Restored and unmuted on ${PLATFORMS[c.platform].label}.`,
        undoConversationId: archived ? c.id : undefined,
      });
    } catch (error) {
      setActionNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "The chat could not be updated. Nothing changed in Omni.",
      });
    } finally {
      setArchivePendingId(null);
    }
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

  function togglePriority(c: ConversationDTO) {
    patchConversation(c.id, { priority: !c.priority });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: !c.priority }),
    }).catch(() => {});
  }

  function toggleTodo(c: ConversationDTO) {
    patchConversation(c.id, {
      todo: !c.todo,
      todoCompleted: false,
      todoAddedAt: !c.todo ? new Date().toISOString() : null,
    });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todo: !c.todo }),
    }).catch(() => {});
  }

  function saveTodoNote(c: ConversationDTO, note: string) {
    patchConversation(c.id, { todoNote: note });
    fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todoNote: note }),
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

  // Forum channels aren't conversations of their own — they're a group of topic
  // conversations. Hiding one means hiding every topic under it, otherwise the
  // channel reappears as soon as any single topic is still visible.
  function toggleHideTopics(topics: ConversationDTO[]) {
    const makeHidden = !topics.every((t) => t.hidden);
    for (const t of topics) {
      patchConversation(t.id, { hidden: makeHidden });
      fetch(`/api/conversations/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: makeHidden }),
      }).catch(() => {});
    }
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

  function clearFolders(c: ConversationDTO) {
    const assigned = [...c.folderIds];
    if (!assigned.length) return;
    patchConversation(c.id, { folderIds: [] });
    Promise.all(
      assigned.map((folderId) =>
        fetch(`/api/conversations/${c.id}/folders?folderId=${folderId}`, {
          method: "DELETE",
        })
      )
    ).catch(() => {});
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

  const activeFilters =
    (platformFilter !== "all" ? 1 : 0) +
    (tagFilter !== "all" ? 1 : 0) +
    (intentFilter !== "all" ? 1 : 0) +
    (view === "needsreply" && replyAgeFilter !== "all" ? 1 : 0) +
    (view === "needsreply" && replySort !== "newest" ? 1 : 0) +
    (view === "needsreply" && openedUnansweredOnly ? 1 : 0) +
    (chatKind !== "all" ? 1 : 0) + (mentionsOnly ? 1 : 0) + (historyIssuesOnly ? 1 : 0);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of conversations) {
      if (
        c.hidden ||
        c.archived ||
        c.status === "done" ||
        c.inboxCategory === "spam"
      )
        continue;
      for (const id of c.folderIds) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [conversations]);

  // Pinned chats are a global shortcut shelf. Lifecycle tabs still filter the
  // main list, but archived chats only appear inside the Archived view.
  const pinned = scoped
    .filter(
      (c) =>
        c.pinned && (view === "archived" ? c.archived : !c.archived)
    )
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
    );
  const unpinned = filtered.filter((c) => !c.pinned);
  const rest = unpinned.slice(0, visibleCount);
  // The compact rail follows the same view. Keep an out-of-filter open chat
  // reachable without silently changing the user's filters or queue position.
  const railConversations = Array.from(new Map([
    ...(selected && !rest.some(c => c.id === selected.id) ? [selected] : []),
    ...rest, ...pinned,
  ].map(c => [c.id, c])).values());

  // Nest forum topics under their parent channel as expandable subchats.
  type ChannelItem = {
    kind: "channel";
    id: string;
    name: string;
    topics: ConversationDTO[];
    unread: number;
    hasUnreadMention: boolean;
    at: number;
  };
  type ConvItem = { kind: "conv"; conv: ConversationDTO; at: number };
  const listItems = useMemo<(ConvItem | ChannelItem)[]>(() => {
    const channels = new Map<string, ChannelItem>();
    const singles: ConvItem[] = [];
    for (const c of rest) {
      if (c.topicOf) {
        const g =
          channels.get(c.topicOf) ||
          ({
            kind: "channel",
            id: c.topicOf,
            name: c.contact.name.split(" · ")[0],
            topics: [],
            unread: 0,
            hasUnreadMention: false,
            at: 0,
          } as ChannelItem);
        g.topics.push(c);
        g.unread += c.unread;
        g.hasUnreadMention ||= c.hasUnreadMention;
        const timestamp = conversationListSortAt(c);
        g.at = view === "needsreply" && replySort === "longest"
          ? g.at === 0
            ? timestamp
            : Math.min(g.at, timestamp)
          : Math.max(g.at, timestamp);
        channels.set(c.topicOf, g);
      } else {
        singles.push({
          kind: "conv",
          conv: c,
          at: conversationListSortAt(c),
        });
      }
    }
    return [...singles, ...channels.values()].sort((a, b) =>
      view === "needsreply" && replySort === "longest"
        ? a.at - b.at
        : b.at - a.at
    );
  }, [rest, replySort, view, conversationListSortAt]);

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
    const foldersOnly = folderMenuId === c.id;
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
            {!foldersOnly && (
              <>
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              {c.archived ? "Inbox" : "Status"}
            </div>
            <div className="px-2.5 pb-1 text-xs text-slate-400 dark:text-neutral-500">
              {c.archived
                ? `Archived and muted on ${PLATFORMS[c.platform].label}`
                : c.lastDirection === "out"
                ? "Cold · waiting on them to reply"
                : "Needs reply · your turn"}
            </div>
            {c.archived ? (
              <MenuRow
                icon={<ArchiveIcon className="h-4 w-4" />}
                onClick={() => {
                  void setArchivedAndMuted(c, false);
                  setMenuId(null);
                }}
              >
                {archivePendingId === c.id ? "Restoring…" : "Restore to inbox"}
              </MenuRow>
            ) : c.status === "done" ? (
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
            {!c.archived &&
              (c.platform === "telegram" || c.platform === "whatsapp") && (
                <MenuRow
                  icon={<ArchiveIcon className="h-4 w-4" />}
                  onClick={() => {
                    void setArchivedAndMuted(c, true);
                    setMenuId(null);
                  }}
                >
                  {archivePendingId === c.id
                    ? "Archiving…"
                    : "Archive & mute"}
                </MenuRow>
              )}

            {!c.archived && (
              <>
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
              </>
            )}

            <div className="my-1 h-px bg-slate-100 dark:bg-neutral-700" />
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              To-do
            </div>
            <MenuRow
              icon={<CheckCircleIcon className="h-4 w-4" />}
              onClick={() => toggleTodo(c)}
            >
              {c.todo ? "Remove from to-do" : "Add to to-do"}
            </MenuRow>
            <MenuRow
              icon={<PinIcon className="h-4 w-4" />}
              className={c.priority ? "text-amber-700 dark:text-amber-300" : ""}
              onClick={() => togglePriority(c)}
            >
              {c.priority ? "Remove priority" : "Mark as priority"}
            </MenuRow>
            {c.todo && (
              <input
                value={c.todoNote || ""}
                onChange={(event) => patchConversation(c.id, { todoNote: event.target.value })}
                onBlur={(event) => saveTodoNote(c, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveTodoNote(c, event.currentTarget.value);
                    setMenuId(null);
                  }
                }}
                placeholder="Add a note…"
                className="mb-1 mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800 outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            )}

            <div className="my-1 h-px bg-slate-100 dark:bg-neutral-700" />
            <MenuRow
              icon={<PinIcon className="h-4 w-4" />}
              className={
                c.id === multiViewPinnedId
                  ? "text-accent dark:text-accent"
                  : ""
              }
              onClick={() => {
                if (c.id === multiViewPinnedId) unpinMultiView();
                else addConversationToMultiView(c.id);
                setMenuId(null);
              }}
            >
              {c.id === multiViewPinnedId
                ? "Remove from Multi view"
                : "Add to Multi view"}
            </MenuRow>
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
            {c.inboxCategory === "spam" && (
              <MenuRow
                icon={<ReplyIcon className="h-4 w-4" />}
                className="text-accent dark:text-accent"
                onClick={() => {
                  moveToGeneral(c);
                  setMenuId(null);
                }}
              >
                Move to general inbox
              </MenuRow>
            )}
              </>
            )}

            {!foldersOnly && (
              <div className="my-1 h-px bg-slate-100 dark:bg-neutral-700" />
            )}
            <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-neutral-200">
                Folders
                {c.folderIds.length > 0 && (
                  <span className="ml-1.5 font-normal tabular-nums text-slate-400 dark:text-neutral-500">
                    {c.folderIds.length} selected
                  </span>
                )}
              </span>
              {c.folderIds.length > 0 && (
                <button
                  onClick={() => clearFolders(c)}
                  className="text-xs font-medium text-slate-400 transition-colors duration-200 hover:text-red-500 dark:text-neutral-500"
                >
                  Clear
                </button>
              )}
            </div>
            {folders.length === 0 && (
              <div className="px-2.5 py-1 text-xs text-slate-400 dark:text-neutral-500">
                No folders yet
              </div>
            )}
            {folders.map((f) => {
              const inFolder = c.folderIds.includes(f.id);
              return (
                <motion.button
                  key={f.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => toggleFolder(c, f.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    inFolder
                      ? "bg-accent/10 text-slate-900 dark:bg-accent/10 dark:text-neutral-100"
                      : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors duration-200 ${
                      inFolder
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-slate-300 bg-white text-transparent dark:border-neutral-600 dark:bg-neutral-800"
                    }`}
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="tabular-nums text-xs text-slate-400 dark:text-neutral-500">
                    {folderCounts.get(f.id) || 0}
                  </span>
                </motion.button>
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
    <div className="workspace-shell inbox-workspace">
      <WorkspaceHeader
        rail
        showUtilities={!readOnly}
        onOpenSettings={() => { setAiSettings(false); setShowSettings(true); }}
        assistant={!readOnly ? <ChatAssistant conversation={selected ?? multiViewPinned} onOpenSettings={() => { setAiSettings(true); setShowSettings(true); }} onOpenConversation={(conversationId, messageId) => { setShowHidden(false); selectConversation(conversationId); setFocusMessageId(messageId); }} /> : undefined}
        brand={!readOnly ? <SyncRestartControl onOpenSettings={() => setShowSettings(true)} expandedBrand /> : undefined}
        onOpenEmails={!readOnly ? () => setShowEmails(true) : undefined}
        actions={!readOnly ? <>
          <NotificationCenter onOpen={openKeywordNotification} onNewNotifications={handleNewKeywordNotifications} />

        </> : undefined}
      />
      <div className="workspace-body">
      <div className={`inbox-list-container ${mobileThreadOpen ? "hidden md:block" : "block"} ${sidebarCollapsed ? "is-compact" : ""}`}>
      {sidebarCollapsed && <aside aria-label="Compact conversation rail" className="inbox-rail hidden md:flex">
        <div className="flex shrink-0 flex-col items-center gap-2 border-b border-slate-100 py-3 dark:border-neutral-800">
          <button ref={expandButtonRef} type="button" onClick={() => setSidebarCompact(false)} className="rail-control" aria-label="Expand inbox sidebar" title="Expand inbox" aria-expanded={false} aria-controls="inbox-sidebar"><SidebarIcon className="h-5 w-5" /></button>
          <button type="button" onClick={() => setPaletteOpen(true)} className="rail-control" aria-label="Search conversations" title="Search conversations (⌘K)"><SearchIcon className="h-5 w-5" /></button>
          {(activeFilters > 0 || folderFilter !== "all" || view !== "all" || showHidden) && <button type="button" onClick={() => { setSidebarCompact(false); setShowFilters(true); }} className="rail-control text-accent" aria-label="Expand inbox to change the current view and filters" title="Showing your current inbox view"><FunnelIcon className="h-4 w-4" /></button>}
        </div>
        <div className="scroll-invisible min-h-0 flex-1 overflow-y-auto py-4" onScroll={event => {
          const list = event.currentTarget;
          if (list.scrollHeight - list.scrollTop - list.clientHeight < 300) setVisibleCount(count => Math.min(unpinned.length, count + 75));
        }}>
          {loading && <div role="status" aria-label="Loading conversations" className="space-y-4 px-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 w-10 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none dark:bg-neutral-800" />)}</div>}
          {loadError && <button type="button" onClick={() => setSidebarCompact(false)} className="rail-control mx-auto text-amber-600" title={loadError} aria-label="Expand inbox to view loading error">!</button>}
          {railConversations.map(c => <button key={c.id} type="button" onClick={() => selectConversation(c.id)}
            onPointerEnter={() => void prefetchConversationMessages(c.id)}
            aria-label={`Open ${c.contact.name} on ${PLATFORMS[c.platform].label}${c.unread > 0 ? `, ${c.unread} unread` : ""}${c.hasUnreadMention ? ", you were mentioned" : ""}${c.pinned ? ", pinned" : ""}`}
            title={`${c.contact.name} · ${PLATFORMS[c.platform].label}${c.unread > 0 ? ` · ${c.unread} unread` : ""}${c.hasUnreadMention ? " · You were mentioned" : ""}${c.pinned ? " · Pinned" : ""}`}
            aria-current={c.id === activeConversationId ? "true" : undefined}
            className={`rail-chat ${c.id === activeConversationId || c.id === multiViewPinnedId ? "rail-chat-selected" : ""}`}>
            <span className="relative"><Avatar name={c.contact.name} platform={c.platform} size="sm" src={c.contact.avatarUrl} group={c.groupPreview} />
              {(c.unread > 0 || c.hasUnreadMention) && <span aria-hidden="true" className={`rail-unread ${c.hasUnreadMention ? "rail-unread-mention" : ""}`}>
                {c.hasUnreadMention && <span>@</span>}{c.unread > 0 && <span>{c.unread > 99 ? "99+" : c.unread}</span>}
              </span>}
            </span>
          </button>)}
          {!loading && !loadError && railConversations.length === 0 && <button type="button" onClick={() => setSidebarCompact(false)} className="mx-2 rounded-lg p-2 text-xs text-slate-500" title="No chats in this view. Expand to change filters.">No chats</button>}
        </div>
      </aside>}
      <aside id="inbox-sidebar" className={`${mobileThreadOpen ? "hidden" : "flex"} ${sidebarCollapsed ? "md:hidden" : "md:flex"} inbox-sidebar`} aria-label="Conversation inbox">
        <div className="inbox-controls px-4 pb-3">
          <div className="inbox-heading flex h-16 items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Messages<span className="ml-2 text-xs font-normal text-slate-400">{compactCount(conversations.length)}</span></h1>
            <div className="flex items-center gap-3">
        {!readOnly && (
          <TodoTray compact
            conversations={conversations}
            onOpenConversation={(id) => {
              setShowHidden(false);
              selectConversation(id);
            }}
          />
        )}
            <button ref={collapseButtonRef} type="button" onClick={() => { rememberScrollAnchor(); setShowFilters(false); setShowFolderPicker(false); setShowViewMenu(false); setShowNewMenu(false); setSidebarCompact(true); }} className="rail-control hidden md:flex" aria-label="Collapse inbox to chat avatars" title="Collapse to chat avatars" aria-expanded={true} aria-controls="inbox-sidebar"><SidebarIcon className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-slate-100 py-2 pl-3 pr-2.5 text-sm text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-200/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-neutral-800 dark:text-neutral-500 dark:hover:bg-neutral-700/70"
            >
              <SearchIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">Search chats…</span>
              <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 shadow-sm dark:bg-neutral-900 dark:text-neutral-500">
                ⌘K
              </kbd>
            </button>
            {!readOnly && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowNewMenu((open) => !open)}
                  title="Start a message or group"
                  aria-haspopup="menu"
                  aria-expanded={showNewMenu}
                  className="flex h-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  <PlusIcon className="h-4 w-4" />
                  New
                </button>
                <AnimatePresence>
                  {showNewMenu && (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-20 cursor-default"
                        onClick={() => setShowNewMenu(false)}
                        aria-label="Close new menu"
                      />
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -4 }}
                        transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                        role="menu"
                        className="absolute right-0 top-full z-30 mt-2 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowNewMenu(false);
                            openNewMessage();
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          <PlusIcon className="h-4 w-4 text-slate-400" />
                          New message
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowNewMenu(false);
                            setShowCreateGroup(true);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          <ChatTypeIcon
                            isGroup
                            handle="Group"
                            className="h-4 w-4 text-slate-400 dark:text-neutral-500"
                          />
                          New group chat
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Status / lifecycle views */}
          {!showHidden && (
            <div className="inbox-view-tabs mb-3 grid grid-cols-[1fr_1fr_1.4fr_auto] items-stretch gap-1 border-b border-slate-200 dark:border-neutral-800">
              {([[
                "all", "All",
              ], ["needsreply", "Reply"], ["requests", "Requests"]] as [InboxView, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  aria-label={`${label}, ${viewCounts[id]} conversations`}
                  aria-pressed={view === id}
                  className={`flex min-h-10 min-w-0 items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${view === id ? "border-accent text-slate-900 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white"}`}
                >
                  <span className="truncate text-center leading-4">{label}</span>
                  <span
                    className={`shrink-0 tabular-nums text-xs leading-4 ${
                      view === id
                        ? "text-slate-500 dark:text-neutral-300"
                        : "text-slate-400 dark:text-neutral-500"
                    }`}
                  >
                    {compactCount(viewCounts[id])}
                  </span>
                </button>
              ))}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowViewMenu((open) => !open)}
                  aria-label="More inbox views"
                  title="More inbox views"
                  className={`h-full rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${["followups", "cold", "snoozed", "archived", "done"].includes(view) || showViewMenu ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white"}`}
                  aria-expanded={showViewMenu}
                >
                  <MoreIcon className="h-4 w-4" />
                </button>
                <AnimatePresence>
                  {showViewMenu && (
                    <>
                      <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setShowViewMenu(false)} aria-label="Close inbox views" />
                      <motion.div initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -4 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                        {([[
                          "followups", "Follow ups",
                        ], ["cold", "Waiting"], ["snoozed", "Snoozed"], ["archived", "Archived"], ["done", "Done"]] as [InboxView, string][]).map(([id, label]) => (
                          <button key={id} type="button" onClick={() => { setView(id); setShowViewMenu(false); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${view === id ? "bg-slate-100 font-semibold text-slate-900 dark:bg-neutral-700 dark:text-white" : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-700"}`}>
                            <span>{label}</span><span className="tabular-nums text-xs text-slate-400">{viewCounts[id]}</span>
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Compact folder picker + filter popover + hidden */}
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowFolderPicker((v) => !v)}
                className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition ${
                  folderFilter !== "all" && !showHidden
                    ? "border-slate-300 bg-white text-slate-800 shadow-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {folderFilter === "all"
                    ? "All folders"
                    : folders.find((f) => f.id === folderFilter)?.name || "All folders"}
                </span>
                <span className="shrink-0 tabular-nums text-slate-400">
                  {folderFilter === "all"
                    ? compactCount(conversations.filter((c) => !c.hidden && !c.archived && c.status !== "done" && c.inboxCategory !== "spam").length)
                    : compactCount(folderCounts.get(folderFilter) || 0)}
                </span>
                <span className={`text-[10px] text-slate-400 transition-transform ${showFolderPicker ? "rotate-180" : ""}`}>⌄</span>
              </motion.button>

              <AnimatePresence>
                {showFolderPicker && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowFolderPicker(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.97, y: -5 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97, y: -5 }}
                      transition={{ duration: 0.14, ease: "easeOut" }}
                      className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-56 origin-top rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      <button
                        onClick={() => {
                          setFolderFilter("all");
                          setShowHidden(false);
                          setShowFolderPicker(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-slate-100 dark:hover:bg-neutral-700 ${folderFilter === "all" && !showHidden ? "font-semibold text-slate-900 dark:text-white" : "text-slate-600 dark:text-neutral-300"}`}
                      >
                        <span className="flex h-5 w-5 items-center justify-center">{folderFilter === "all" && !showHidden ? <CheckIcon className="h-3.5 w-3.5" /> : null}</span>
                        <span className="flex-1">All folders</span>
                        <span className="tabular-nums text-slate-400">{conversations.filter((c) => !c.hidden && !c.archived && c.status !== "done" && c.inboxCategory !== "spam").length}</span>
                      </button>
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            setFolderFilter(f.id);
                            setShowHidden(false);
                            setShowFolderPicker(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-slate-100 dark:hover:bg-neutral-700 ${folderFilter === f.id && !showHidden ? "font-semibold text-slate-900 dark:text-white" : "text-slate-600 dark:text-neutral-300"}`}
                        >
                          <span className="flex h-5 w-5 items-center justify-center">{folderFilter === f.id && !showHidden ? <CheckIcon className="h-3.5 w-3.5" /> : <FolderIcon className="h-3.5 w-3.5 text-slate-400" />}</span>
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="tabular-nums text-slate-400">{folderCounts.get(f.id) || 0}</span>
                        </button>
                      ))}
                      <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />
                      <button
                        onClick={() => {
                          setShowFolderPicker(false);
                          openNewFolder(null);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-accent transition hover:bg-slate-100 dark:hover:bg-neutral-700"
                      >
                        <span className="flex h-5 w-5 items-center justify-center"><PlusIcon className="h-3.5 w-3.5" /></span>
                        New folder
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <div className="relative shrink-0">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowFilters((v) => !v)}
                title="Filter conversations"
                ref={filterTriggerRef}
                aria-label="Filter conversations"
                aria-expanded={showFilters}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  activeFilters || showFilters
                    ? "bg-accent/15 text-accent dark:bg-accent/15 dark:text-accent"
                    : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                <FunnelIcon className="h-3.5 w-3.5" />
                {platformFilter !== "all" && <span>{PLATFORMS[platformFilter].label}</span>}
                {activeFilters > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-accent-fg">
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
                      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                      className="absolute right-0 top-full z-20 mt-1.5 max-h-[70dvh] w-64 origin-top-right overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                    >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">
                        Filters
                      </span>
                      {activeFilters > 0 && (
                        <button
                          onClick={() => {
                            setPlatformFilter("all");
                            setTagFilter("all");
                            setIntentFilter("all");
                            setReplyAgeFilter("all");
                            setReplySort("newest");
                            setOpenedUnansweredOnly(false);
                            setChatKind("all");
                            setMentionsOnly(false);
                            setHistoryIssuesOnly(false);
                          }}
                          className="rounded-md px-2 py-1 text-xs font-medium text-accent transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {!showHidden && view === "needsreply" && (
                      <div className="mb-3 rounded-lg bg-slate-50 p-2 dark:bg-[#272727]">
                        <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                          Reply queue
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="relative block min-w-0">
                            <span className="mb-1 block text-xs text-slate-400 dark:text-neutral-500">Waiting</span>
                            <ClockIcon className="pointer-events-none absolute bottom-2 left-2 h-3.5 w-3.5 text-slate-400 dark:text-neutral-500" />
                            <select
                              value={replyAgeFilter}
                              onChange={(event) => setReplyAgeFilter(event.target.value as ReplyAgeFilter)}
                              className={`h-8 w-full appearance-none truncate rounded-md border bg-white pl-7 pr-5 text-xs font-medium outline-none transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:ring-2 focus:ring-accent/30 dark:bg-[#1F1F1F] ${replyAgeFilter === "all" ? "border-slate-200 text-slate-600 dark:border-neutral-700 dark:text-neutral-300" : "border-accent/40 text-accent"}`}
                            >
                              {REPLY_AGE_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute bottom-2 right-2 text-xs text-slate-400 dark:text-neutral-500">⌄</span>
                          </label>
                          <label className="relative block min-w-0">
                            <span className="mb-1 block text-xs text-slate-400 dark:text-neutral-500">Order</span>
                            <SortIcon className="pointer-events-none absolute bottom-2 left-2 h-3.5 w-3.5 text-slate-400 dark:text-neutral-500" />
                            <select
                              value={replySort}
                              onChange={(event) => setReplySort(event.target.value as ReplySort)}
                              className="h-8 w-full appearance-none truncate rounded-md border border-slate-200 bg-white pl-7 pr-5 text-xs font-medium text-slate-600 outline-none transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus:ring-2 focus:ring-accent/30 dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-neutral-300"
                            >
                              <option value="newest">Newest</option>
                              <option value="longest">Longest</option>
                            </select>
                            <span className="pointer-events-none absolute bottom-2 right-2 text-xs text-slate-400 dark:text-neutral-500">⌄</span>
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenedUnansweredOnly((current) => !current)
                          }
                          aria-pressed={openedUnansweredOnly}
                          className={`mt-2 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/30 ${
                            openedUnansweredOnly
                              ? "border-accent/40 bg-accent/10 text-accent"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-neutral-300 dark:hover:bg-neutral-700"
                          }`}
                        >
                          <EyeIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            Opened, not replied
                          </span>
                          <span
                            aria-hidden="true"
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                              openedUnansweredOnly
                                ? "border-accent bg-accent text-accent-fg"
                                : "border-slate-300 dark:border-neutral-600"
                            }`}
                          >
                            {openedUnansweredOnly && (
                              <CheckIcon className="h-2.5 w-2.5" />
                            )}
                          </span>
                        </button>
                      </div>
                    )}
                    <label className="mb-3 block text-xs font-medium text-slate-500 dark:text-neutral-400">
                      Conversation type
                      <select value={chatKind} onChange={e => setChatKind(e.target.value as ChatKind)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-neutral-200">
                        <option value="all">All conversations</option><option value="direct">Direct messages</option><option value="groups">Group chats</option><option value="channels">Broadcast channels</option>
                      </select>
                    </label>
                    <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-neutral-300"><input type="checkbox" checked={mentionsOnly} onChange={e => setMentionsOnly(e.target.checked)} className="accent-accent focus-visible:ring-2 focus-visible:ring-accent" />Unread mentions</label>
                    <label className="mb-3 flex items-center gap-2 text-xs text-slate-600 dark:text-neutral-300"><input type="checkbox" checked={historyIssuesOnly} onChange={e => setHistoryIssuesOnly(e.target.checked)} className="accent-accent focus-visible:ring-2 focus-visible:ring-accent" />Pending history checks</label>
                    {view === "needsreply" && <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-neutral-400">Broadcast channels stay in All, not Reply. Failed or unconfirmed sends do not count as replies.</p>}
                    <div className="mb-1.5 text-xs font-semibold text-slate-400 dark:text-neutral-500">
                      Platform
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
                          aria-label={`Filter ${PLATFORMS[p].label} conversations`}
                          aria-pressed={platformFilter === p}
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
                    <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-neutral-400">
                      Intent
                      <select value={intentFilter} onChange={e => setIntentFilter(e.target.value as IntentFilter)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-neutral-200">
                        <option value="all">Any intent</option>
                        {(Object.keys(INTENTS) as ConversationDTO["intent"][]).map(intent => <option key={intent} value={intent}>{INTENTS[intent].label}</option>)}
                      </select>
                    </label>
                    {tags.length > 0 && (
                      <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-neutral-400">
                        Tag
                        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-neutral-200">
                          <option value="all">Any tag</option>
                          {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                        </select>
                      </label>
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

        <div
          ref={inboxScrollRef}
          className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3 [overflow-anchor:none]"
          onScroll={(e) => {
            rememberScrollAnchor();
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 500)
              setVisibleCount((count) => Math.min(unpinned.length, count + 75));
          }}
        >
          {loading && (
            <div role="status" aria-label="Loading conversations" className="space-y-4 p-4">{Array.from({ length: 7 }, (_, i) => <div key={i} className="flex animate-pulse items-center gap-3 motion-reduce:animate-none"><div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-neutral-800" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-neutral-800" /><div className="h-3 rounded bg-slate-100 dark:bg-neutral-800" /></div></div>)}</div>
          )}
          {!loading && loadError && (
            <div className="mx-3 my-4 rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/70 dark:bg-red-950/30">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                Inbox couldn&apos;t load
              </p>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => void loadInbox()}
                className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:bg-red-600 dark:hover:bg-red-500 dark:focus:ring-offset-neutral-950"
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !loadError && filtered.length === 0 && pinned.length === 0 && (
            <div className="px-6 py-12 text-center">
              <SearchIcon className="mx-auto mb-4 h-6 w-6 text-slate-300 dark:text-neutral-600" />
              <h2 className="text-sm font-semibold text-slate-700 dark:text-neutral-200">{view === "archived" ? "No archived chats" : "No conversations in this view"}</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">{activeFilters > 0 ? "Try a different platform or adjust your filters." : "Choose another inbox view or search for a conversation."}</p>
              <button type="button" onClick={() => activeFilters > 0 ? setShowFilters(true) : setPaletteOpen(true)} className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">{activeFilters > 0 ? "Adjust filters" : "Search conversations"}</button>
            </div>
          )}
          {menuId && (
            <div
              className="fixed inset-0 z-10"
              onClick={() => {
                setMenuId(null);
                setFolderMenuId(null);
              }}
            />
          )}

          {/* Pinned chats stay collapsed until needed so the conversation list
              remains the primary surface. */}
          {pinned.length > 0 && (
            <section className="border-b border-slate-100 px-2 py-2 dark:border-neutral-800/70" aria-label="Pinned conversations">
              <button
                type="button"
                onClick={() => setPinnedExpanded((open) => !open)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800"
                aria-expanded={pinnedExpanded}
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-neutral-200">
                  <PinIcon className="h-3.5 w-3.5 text-slate-400" />
                  Pinned
                  <span className="tabular-nums text-slate-400 dark:text-neutral-500">{pinned.length}</span>
                </span>
                <span className={`text-xs text-slate-400 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${pinnedExpanded ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
              </button>
              {pinnedExpanded && (
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {pinned.map((c) => (
                    <div key={c.id} className="group relative min-w-0">
                      <button
                        type="button"
                        onClick={() => selectConversation(c.id)}
                        onPointerEnter={() => void prefetchConversationMessages(c.id)}
                        onFocus={() => void prefetchConversationMessages(c.id)}
                        className={`flex w-full min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800 ${c.id === activeConversationId || c.id === multiViewPinnedId ? "bg-accent/10" : ""}`}
                      >
                        <span className="relative">
                          <Avatar name={c.contact.name} platform={c.platform} size="sm" src={c.contact.avatarUrl} group={c.groupPreview} />
                          {c.unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{c.unread}</span>}
                          {c.hasUnreadMention && (
                            <span
                              title="You were mentioned"
                              aria-label="You were mentioned"
                              className="absolute -bottom-1 -left-1 grid h-4 w-4 place-items-center rounded-full bg-violet-100 text-violet-700 ring-2 ring-white dark:bg-violet-500/25 dark:text-violet-200 dark:ring-neutral-900"
                            >
                              <AtSignIcon className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                        <span className="w-full truncate text-center text-xs font-medium text-slate-600 dark:text-neutral-300">{c.contact.name.split(" ")[0]}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); setFolderMenuId(null); setMenuId((current) => current === c.id ? null : c.id); }}
                        className="absolute right-0 top-0 hidden rounded-md bg-white p-1 text-slate-500 shadow-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:block focus:block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-neutral-700 dark:text-neutral-300"
                        aria-label={`Options for ${c.contact.name}`}
                      >
                        <MoreIcon className="h-3 w-3" />
                      </button>
                      {convActionsMenu(c, "left-0 top-full mt-1 origin-top-left")}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {(() => {
            const renderRow = (c: ConversationDTO, indent = false) => (
            <motion.div
              key={c.id}
              data-conversation-id={c.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${c.contact.name}${c.unread > 0 ? `, ${c.unread} unread` : ""}`}
              aria-current={c.id === activeConversationId ? "true" : undefined}
              onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectConversation(c.id); } }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              onClick={() => selectConversation(c.id)}
              onPointerEnter={() => void prefetchConversationMessages(c.id)}
              className={`inbox-row group relative flex cursor-pointer items-center gap-3 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${c.priority ? "border-amber-300 bg-amber-50/60 ring-1 ring-inset ring-amber-300/70 dark:border-amber-500/50 dark:bg-amber-500/5 dark:ring-amber-500/40" : "border-slate-100 dark:border-neutral-800/70"} ${
                indent ? "bg-slate-50/60 pl-12 dark:bg-neutral-900/40" : "pl-4"
              } ${
                c.id === activeConversationId || c.id === multiViewPinnedId
                  ? "inbox-row-selected"
                  : "hover:bg-slate-50 dark:hover:bg-neutral-800/60"
              }`}
            >
              <Avatar
                name={c.contact.name}
                platform={c.platform}
                size="sm"
                src={c.contact.avatarUrl}
                group={c.groupPreview}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`flex min-w-0 items-center gap-1.5 text-sm ${c.unread > 0 ? "font-semibold text-slate-950 dark:text-white" : "font-medium text-slate-700 dark:text-neutral-200"}`}>
                    {c.status !== "done" && !isSnoozed(c) && (
                      <span
                        title={
                          c.lastDirection === "out"
                            ? "Waiting on them"
                            : "Needs reply"
                        }
                        className={`h-1 w-1 shrink-0 rounded-full ${
                          c.lastDirection === "out"
                            ? "bg-sky-400 dark:bg-sky-500"
                            : "bg-amber-500"
                        }`}
                      />
                    )}
                    {!indent && (
                      <ChatTypeIcon isGroup={c.isGroup} handle={c.contact.handle} />
                    )}
                    <span className="truncate">
                      {indent
                        ? c.contact.name.split(" · ").slice(1).join(" · ") ||
                          c.contact.name
                        : c.contact.name}
                    </span>
                    {c.priority && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        Priority
                      </span>
                    )}
                    {dupAccountTag(c) && (
                      <span
                        title={`via ${c.account?.label}`}
                        className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-medium text-accent dark:text-accent"
                      >
                        {dupAccountTag(c)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400 group-hover:hidden group-focus-within:hidden dark:text-neutral-500">
                    {isSnoozed(c) && (
                      <span className="flex items-center gap-0.5 text-accent dark:text-accent">
                        <ClockIcon className="h-3 w-3" />
                        {snoozeLabel(c.snoozedUntil!)}
                      </span>
                    )}
                    {(c.previewOnly || chatSyncIssue(c.externalId, connectionFor(c)?.sync)) && <span title="History check pending. Open the chat's history menu for details." aria-label="History check pending"><ClockIcon className="h-3 w-3 text-amber-500" /></span>}
                    <span title={new Date(c.lastMessageAt).toLocaleString()}>
                      {inboxDateTime(c.lastMessageAt)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      drafts[c.id]?.text.trim()
                        ? "text-slate-600 dark:text-neutral-300"
                        : "text-slate-500 dark:text-neutral-400"
                    }`}
                  >
                    {drafts[c.id]?.text.trim() ? (
                      <>
                        <span className="font-semibold text-accent">Draft</span>
                        <span className="text-slate-400 dark:text-neutral-500"> · </span>
                        {drafts[c.id].text.trim()}
                      </>
                    ) : (
                      <>{c.lastMessageDelivery && c.lastMessageDelivery !== "sent" && <span className="font-medium text-amber-600 dark:text-amber-400">{c.lastMessageDelivery === "failed" ? "Failed: " : c.lastMessageDelivery === "unconfirmed" ? "Unconfirmed: " : "Sending: "}</span>}{c.lastMessage}</>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {c.followUpAt &&
                      new Date(c.followUpAt).getTime() <= Date.now() && (
                        <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                          Follow up
                        </span>
                      )}
                    {view === "needsreply" &&
                      c.lastDirection === "in" &&
                      calendarDaysAgo(c.lastMessageAt) > 0 && (
                        <span
                          title={`Waiting ${calendarDaysAgo(c.lastMessageAt)} ${calendarDaysAgo(c.lastMessageAt) === 1 ? "day" : "days"} for your reply`}
                          className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        >
                          {calendarDaysAgo(c.lastMessageAt)}d waiting
                        </span>
                      )}
                    {c.status !== "done" &&
                      !isSnoozed(c) &&
                      view !== "needsreply" &&
                      coldDays(c) >= settings.coldDays && (
                        <span
                          title={`Untouched for ${coldDays(c)} days`}
                          className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold leading-none text-amber-700 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-300"
                        >
                          <ClockIcon className="h-3 w-3" />
                          {coldDays(c)}d
                        </span>
                      )}
                    {c.hasUnreadMention && (
                      <span
                        title="You were mentioned"
                        aria-label="You were mentioned"
                        className="grid h-5 w-5 place-items-center rounded-full bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/20 dark:text-violet-200 dark:ring-violet-400/20"
                      >
                        <AtSignIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {c.unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Hover ⋯ menu */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const opening = menuId !== c.id || folderMenuId !== c.id;
                  setMenuId(opening ? c.id : null);
                  setFolderMenuId(opening ? c.id : null);
                }}
                className="absolute right-9 top-2 hidden rounded-md p-1 text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-200 hover:text-slate-700 group-hover:block group-focus-within:block dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                aria-label="Manage folders"
                title="Manage folders"
              >
                <FolderIcon className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderMenuId(null);
                  setMenuId((m) => (m === c.id ? null : c.id));
                }}
                className="absolute right-2 top-2 hidden rounded p-1 text-slate-500 hover:bg-slate-200 group-hover:block group-focus-within:block dark:text-neutral-400 dark:hover:bg-neutral-700"
                aria-label="Chat options"
              >
                ⋯
              </button>

              {convActionsMenu(c, "right-2 top-9 origin-top-right")}
            </motion.div>
            );
            const renderChannel = (g: ChannelItem) => {
              const recent = [...g.topics].sort(
                (a, b) =>
                  new Date(b.lastMessageAt).getTime() -
                  new Date(a.lastMessageAt).getTime()
              )[0];
              const active = g.topics.some(
                (topic) =>
                  topic.id === activeConversationId ||
                  topic.id === multiViewPinnedId
              );
              const allHidden = g.topics.every((t) => t.hidden);
              return (
                <div key={"ch_" + g.id} className="group relative">
                <button
                  onClick={() => recent && selectConversation(recent.id)}
                  onPointerEnter={() => {
                    if (recent) void prefetchConversationMessages(recent.id);
                  }}
                  onFocus={() => {
                    if (recent) void prefetchConversationMessages(recent.id);
                  }}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 pr-12 text-left transition-colors dark:border-neutral-800/70 ${
                    active
                      ? "bg-accent/15 dark:bg-accent/10"
                      : "hover:bg-slate-50 dark:hover:bg-neutral-800/60"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-500 dark:bg-neutral-700 dark:text-neutral-300">
                    <ChatTypeIcon isGroup handle="Channel" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-slate-900 dark:text-neutral-100">
                        {g.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400 dark:text-neutral-500">
                        {g.topics.length} topics
                      </span>
                    </div>
                    <div className="truncate text-xs text-slate-400 dark:text-neutral-500">
                      Open — switch topics with the tabs inside
                    </div>
                  </div>
                  {g.hasUnreadMention && (
                    <span
                      title="You were mentioned in a topic"
                      aria-label="You were mentioned in a topic"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/20 dark:text-violet-200 dark:ring-violet-400/20"
                    >
                      <AtSignIcon className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {g.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                      {g.unread}
                    </span>
                  )}
                </button>
                {/* Channels have no ⋯ menu of their own, so hide lives here.
                    Sibling of the row button, not nested inside it. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHideTopics(g.topics);
                  }}
                  className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-200 group-hover:block group-focus-within:block dark:text-neutral-400 dark:hover:bg-neutral-700"
                  aria-label={allHidden ? "Unhide channel" : "Hide channel"}
                  title={allHidden ? "Unhide channel" : "Hide channel (not a client)"}
                >
                  {allHidden ? (
                    <EyeIcon className="h-4 w-4" />
                  ) : (
                    <EyeOffIcon className="h-4 w-4" />
                  )}
                </button>
                </div>
              );
            };
            return listItems.map((item) =>
              item.kind === "conv"
                ? renderRow(item.conv)
                : renderChannel(item)
            );
          })()}
          {visibleCount < unpinned.length && (
            <button
              onClick={() => setVisibleCount((count) => count + 75)}
              className="w-full py-4 text-center text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              Load more conversations
            </button>
          )}
        </div>
      </aside>

      {/* Thread workspace */}
      </div>
      <main id="conversation-workspace"
        className={`${mobileThreadOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col overflow-hidden`}
      >
        {multiViewPinned ? (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white p-1.5 lg:hidden dark:border-neutral-800 dark:bg-neutral-900">
              <button
                type="button"
                onClick={() => setMobileMultiPane("pinned")}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  mobileMultiPane === "pinned"
                    ? "bg-accent/15 text-accent"
                    : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                <PinIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {multiViewPinned.contact.name}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMobileMultiPane("browse")}
                className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  mobileMultiPane === "browse"
                    ? "bg-accent/15 text-accent"
                    : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {selected ? selected.contact.name : "Second chat"}
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
              <section
                className={`${mobileMultiPane === "pinned" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col border-slate-200 lg:flex lg:border-r dark:border-neutral-800`}
                aria-label={`Pinned chat with ${multiViewPinned.contact.name}`}
              >
                <ChatThread
                  key={`multi-pinned-${multiViewPinned.id}`}
                  conversation={multiViewPinned}
                  syncStatus={connectionFor(multiViewPinned)}
                  snippets={snippets}
                  onManageSnippets={() => setShowSnippets(true)}
                  onSent={(preview) =>
                    handleSent(multiViewPinned.id, preview)
                  }
                  onArchiveAndMute={() =>
                    void setArchivedAndMuted(
                      multiViewPinned,
                      !multiViewPinned.archived
                    )
                  }
                  archiveAndMutePending={archivePendingId === multiViewPinned.id}
                  onOpenContact={() =>
                    toggleContactFor(multiViewPinned.id)
                  }
                  onOpenTaggedPerson={readOnly ? undefined : openNewMessage}
                  onOpenConversation={readOnly ? undefined : handleStartedConversation}
                  readOnly={readOnly}
                  topics={multiViewPinnedTopics}
                  onSelectTopic={pinConversationInMultiView}
                  onBack={() => {
                    releaseConversationFromQueue(multiViewPinned.id);
                    setMobileThreadOpen(false);
                    setShowContact(false);
                  }}
                  multiViewAction={{
                    label: "Unpin",
                    kind: "unpin",
                    onClick: unpinMultiView,
                  }}
                  multiViewCompact
                />
              </section>

              <section
                className={`${mobileMultiPane === "browse" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex`}
                aria-label="Second chat"
              >
                {selected ? (
                  <ChatThread
                    key={`multi-browse-${selected.id}`}
                    conversation={selected}
                    syncStatus={connectionFor(selected)}
                    snippets={snippets}
                    onManageSnippets={() => setShowSnippets(true)}
                    onSent={(preview) => handleSent(selected.id, preview)}
                    onMarkDone={() => markDoneAndAdvance(selected)}
                    onArchiveAndMute={() =>
                      void setArchivedAndMuted(selected, !selected.archived)
                    }
                    archiveAndMutePending={archivePendingId === selected.id}
                    onOpenContact={() => toggleContactFor(selected.id)}
                    onOpenTaggedPerson={readOnly ? undefined : openNewMessage}
                    onOpenConversation={readOnly ? undefined : handleStartedConversation}
                    readOnly={readOnly}
                    topics={selectedTopics}
                    onSelectTopic={selectConversation}
                    focusMessageId={focusMessageId}
                    onBack={() => {
                      releaseConversationFromQueue(selected.id);
                      setMobileThreadOpen(false);
                      setShowContact(false);
                    }}
                    multiViewAction={{
                      label: "Close pane",
                      kind: "close",
                      onClick: () => {
                        releaseConversationFromQueue(selected.id);
                        setSelectedId(null);
                        setMobileMultiPane("pinned");
                      },
                    }}
                    multiViewCompact
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
                      <PlusIcon className="h-4 w-4" />
                    </span>
                    <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">
                      Choose a second chat
                    </p>
                    <p className="mt-1 max-w-xs text-xs leading-5 text-slate-400 dark:text-neutral-500">
                      Select any conversation from the inbox. Your pinned chat
                      stays open and keeps its place.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : selected ? (
          <ChatThread
            key={selected.id}
            conversation={selected}
            syncStatus={connectionFor(selected)}
            snippets={snippets}
            onManageSnippets={() => setShowSnippets(true)}
            onSent={(preview) => handleSent(selected.id, preview)}
            onMarkDone={() => markDoneAndAdvance(selected)}
            onArchiveAndMute={() =>
              void setArchivedAndMuted(selected, !selected.archived)
            }
            archiveAndMutePending={archivePendingId === selected.id}
            onOpenContact={() => toggleContactFor(selected.id)}
            onOpenTaggedPerson={readOnly ? undefined : openNewMessage}
            onOpenConversation={readOnly ? undefined : handleStartedConversation}
            readOnly={readOnly}
            topics={selectedTopics}
            onSelectTopic={selectConversation}
            focusMessageId={focusMessageId}
            onBack={() => {
              releaseConversationFromQueue(selected.id);
              setMobileThreadOpen(false);
              setShowContact(false);
            }}
            multiViewAction={{
              label: "Multi view",
              kind: "pin",
              onClick: () => pinConversationInMultiView(selected.id),
            }}
          />
        ) : loading ? (
          <div role="status" aria-label="Loading inbox" className="mx-auto flex h-full w-full max-w-xl flex-col justify-center gap-4 px-8">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-neutral-800" />
            <div className="h-16 w-3/4 animate-pulse rounded-md bg-slate-50 motion-reduce:animate-none dark:bg-[#1F1F1F]" />
            <div className="ml-auto h-16 w-2/3 animate-pulse rounded-md bg-slate-50 motion-reduce:animate-none dark:bg-[#1F1F1F]" />
          </div>
        ) : loadError ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-semibold">Inbox could not be loaded</p>
            <p className="max-w-sm text-sm text-slate-500 dark:text-neutral-400">{loadError}</p>
            <button type="button" onClick={() => void loadInbox()} className="workspace-menu-item">Try again</button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-400 dark:text-neutral-500">
            <CheckCircleIcon className="h-6 w-6" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">
              {view === "needsreply"
                ? "Reply backlog clear"
                : view === "requests"
                  ? "Request backlog clear"
                  : view === "archived"
                    ? "No archived chats"
                  : "Select a conversation"}
            </p>
            {view === "archived" ? (
              <p className="mt-1 text-xs">
                Archived chats stay searchable and can be restored anytime.
              </p>
            ) : (
              (view === "needsreply" || view === "requests") && (
                <p className="mt-1 text-xs">New messages will appear here.</p>
              )
            )}
          </div>
        )}
      </main>

      {/* CRM panel — hidden until opened via the info button */}
      <AnimatePresence>
        {contactConversation && showContact && (
          <>
            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} type="button" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setShowContact(false)} aria-label="Dismiss contact panel" />
            <ContactPanel
              key={contactConversation.id}
              conversation={contactConversation}
              allTags={tags}
              conversations={conversations}
              onSelectConversation={selectConversation}
              onContactChanged={handleContactChanged}
              onTagsChanged={handleTagsChanged}
              onIntentChanged={(intent) =>
                patchConversation(contactConversation.id, { intent })
              }
              onFocusMessage={(messageId) => {
                setFocusMessageId(messageId);
                setShowContact(false);
              }}
              onTagCreated={(tag) =>
                setTags((ts) =>
                  ts.some((t) => t.id === tag.id) ? ts : [...ts, tag]
                )
              }
              onClose={() => {
                setShowContact(false);
                setContactConversationId(null);
              }}
              readOnly={readOnly}
            />
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {actionNotice && (
          <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3">
            <motion.aside
              initial={{ opacity: 0, y: -48, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -48, scale: 0.98 }}
              transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
              className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-white/90 p-3 shadow-xl backdrop-blur-xl dark:bg-[#1F1F1F]/90 ${
                actionNotice.tone === "error"
                  ? "border-red-200 dark:border-red-500/30"
                  : "border-emerald-200 dark:border-emerald-500/30"
              }`}
              role={actionNotice.tone === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                  actionNotice.tone === "error"
                    ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300"
                    : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                }`}
              >
                {actionNotice.tone === "error" ? (
                  <CloseIcon className="h-4 w-4" />
                ) : (
                  <ArchiveIcon className="h-4 w-4" />
                )}
              </span>
              <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-slate-700 dark:text-neutral-200">
                {actionNotice.message}
              </p>
              {actionNotice.undoConversationId && (
                <button
                  type="button"
                  onClick={() => {
                    const conversation = conversations.find(
                      (candidate) =>
                        candidate.id === actionNotice.undoConversationId
                    );
                    setActionNotice(null);
                    if (conversation)
                      void setArchivedAndMuted(conversation, false);
                  }}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent/10 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Undo
                </button>
              )}
              <button
                type="button"
                onClick={() => setActionNotice(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-[#313131] dark:hover:text-neutral-200"
                aria-label="Dismiss"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {incomingNotice && !actionNotice && (
          <div className="pointer-events-none fixed inset-x-3 top-20 z-50 flex justify-center md:inset-x-auto md:bottom-4 md:left-4 md:top-auto">
            <motion.aside
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{
                duration: 0.7,
                ease: [0.32, 0.72, 0, 1],
              }}
              className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/70 bg-white/90 p-3 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-[#1F1F1F]/90"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                    incomingNotice.keywordNotification
                      ? "bg-accent/15 text-accent"
                      : "bg-slate-100 text-slate-700 dark:bg-[#313131] dark:text-neutral-100"
                  }`}
                >
                  {incomingNotice.keywordNotification ? (
                    <BellIcon className="h-4 w-4" />
                  ) : (
                    <PlatformGlyph
                      platform={incomingNotice.platform}
                      className="h-4 w-4"
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">
                      {incomingNotice.keywordNotification
                        ? `Keyword alert · ${incomingNotice.name}`
                        : incomingNotice.name}
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-neutral-500">
                      now
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-neutral-300">
                    {incomingNotice.keywordNotification && (
                      <span className="font-semibold text-accent">
                        “{incomingNotice.keywordNotification.matchedPhrase}” ·{" "}
                      </span>
                    )}
                    {incomingNotice.preview}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIncomingNotice(null)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-[#313131] dark:hover:text-neutral-200"
                  aria-label="Dismiss notification"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (incomingNotice.keywordNotification) {
                      openKeywordNotification(incomingNotice.keywordNotification);
                    } else {
                      openConversationNormally(incomingNotice.conversationId);
                    }
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-[#313131]"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addConversationToMultiView(incomingNotice.conversationId)
                  }
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition-colors duration-200 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  Add to Multi view
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>{!readOnly && showEmails && <EmailHistory onClose={() => setShowEmails(false)} onOpen={(conversationId, messageId) => { setShowHidden(false); selectConversation(conversationId); setFocusMessageId(messageId); }} />}</AnimatePresence>

      <AnimatePresence>
        {!readOnly && showSettings && <SettingsModal initialPage={aiSettings ? "ai" : "general"} onClose={() => { setShowSettings(false); setAiSettings(false); }} />}
      </AnimatePresence>

      <AnimatePresence>
        {!readOnly && showNewMessage && (
          <NewMessageModal
            onClose={closeNewMessage}
            onStarted={handleStartedConversation}
            initialRecipient={newMessageRecipient}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateGroup && (
          <CreateGroupModal
            onClose={() => setShowCreateGroup(false)}
            onCreated={() =>
              fetch("/api/conversations")
                .then((r) => r.json())
                .then(setConversations)
                .catch(() => {})
            }
          />
        )}
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
            onOpenChat={(id, messageId) => {
              setShowHidden(false);
              selectConversation(id);
              setFocusMessageId(messageId ?? null);
            }}
            onAddToFolder={addConvsToFolder}
            onCreateFolder={createFolderReturning}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {newFolderOpen && (
          <OverlayPortal onClose={() => setNewFolderOpen(false)}><motion.div role="dialog" aria-modal="true" aria-label="New folder"
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
          </motion.div></OverlayPortal>
        )}
      </AnimatePresence>
      </div>
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
