"use client";

import {
  Fragment,
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { MenuDetails } from "./MenuDetails";
import { ClosePaneButton } from "./ClosePaneButton";
import { OverlayPortal } from "./OverlayPortal";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { InlineVideoPlayer } from "./InlineVideoPlayer";
import { isGifMedia } from "@/lib/gif-media";
import { canAutoLoadMedia, visibleMediaQueue } from "@/lib/automatic-media";
import { groupPeopleLabel } from "@/lib/group-avatars";
import { groupMessageSender, messageSenderKey } from "@/lib/message-sender";
import { showDirectMessageTimestamp } from "@/lib/direct-message-layout";
import { deliveryIds, mergeDelivery, mergeDeliveryReceipt, observedMessageIds, removeMissingMessages } from "@/lib/message-delivery";
import { mergeMessageWindow, orderMessageWindow, projectMessageTimeline } from "@/lib/message-timeline";
import {
  MEDIA_LABEL,
  type ConversationDTO,
  type MessageDTO,
  type SnippetDTO,
} from "@/lib/types";
import {
  PLATFORMS,
  PLATFORM_ATTACHMENTS,
  type Platform,
  mimeToMediaType,
} from "@/lib/platforms";
import { clockTime, dayLabel, sameDay } from "@/lib/time";
import { loadSettings, calcomUrl } from "@/lib/settings";
import { emailsIn } from "@/lib/email";
import { MESSAGE_PIN_CHANGED_EVENT } from "@/lib/shared-content";
import {
  loadConversationDraft,
  saveConversationDraft,
} from "@/lib/drafts";

// Heuristic: does the text mention a date/time worth offering to book around?
const DATE_RE =
  /\b(today|tonight|tomorrow|tmrw|mon(day)?|tues?(day)?|wed(nesday)?|thur?s?(day)?|fri(day)?|sat(urday)?|sun(day)?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?|next week|this week|next month)\b|\b\d{1,2}\s?(am|pm)\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\/\d{1,2}\b/i;
function mentionsDate(text: string): boolean {
  return !!text && DATE_RE.test(text);
}

const MESSAGE_URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION_RE = /[),.!?;:\]}]+$/;

function compactUrlLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    const label = `${host}${path}`;
    if (label.length <= 48) return label;

    const firstPathSegment = path.split("/").filter(Boolean)[0];
    return firstPathSegment ? `${host}/${firstPathSegment}/…` : host;
  } catch {
    return rawUrl.length > 48 ? `${rawUrl.slice(0, 45)}…` : rawUrl;
  }
}

export type TaggedPersonTarget = {
  platform: Extract<Platform, "telegram" | "whatsapp">;
  accountId: string | null;
  target: string;
  label: string;
};

type GroupMemberProfile = {
  id: string;
  name: string;
  handle: string;
  externalKey: string | null;
  avatarUrl: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
};

type DirectConversationPreview = {
  id: string;
  accountId: string | null;
  accountLabel: string | null;
  lastMessageAt: string;
  messages: Array<{
    id: string;
    body: string;
    direction: string;
    mediaType: string | null;
    mediaName: string | null;
    createdAt: string;
  }>;
};

const DIRECT_MEDIA_LABELS: Record<string, string> = {
  image: "Photo",
  video: "Video",
  audio: "Voice message",
  file: "File",
  sticker: "Sticker",
};

function directMessagePreview(
  message: DirectConversationPreview["messages"][number],
): string {
  return (
    message.body.trim() ||
    message.mediaName ||
    (message.mediaType
      ? DIRECT_MEDIA_LABELS[message.mediaType] || "Attachment"
      : "Message")
  );
}

const TAG_MENTION_RE = /@(?:\d{8,}|[A-Za-z][A-Za-z0-9_]{4,31})/g;

function MentionText({
  text,
  platform,
  mentionNames,
  mentionTargets,
  onOpenMention,
}: {
  text: string;
  platform: Platform;
  mentionNames?: Record<string, string>;
  mentionTargets?: Record<string, string>;
  onOpenMention?: (target: string, label: string) => void;
}) {
  const content: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TAG_MENTION_RE)) {
    const start = match.index ?? 0;
    const token = match[0];
    const previous = start > 0 ? text[start - 1] : "";
    // Don't turn the domain half of an email address into a person tag.
    if (previous && /[\w@]/.test(previous)) continue;

    if (start > cursor) content.push(text.slice(cursor, start));

    const numericId = token.match(/^@(\d{8,})$/)?.[1];
    const isWhatsAppMention = platform === "whatsapp" && !!numericId;
    const isTelegramMention = platform === "telegram" && !numericId;
    const target = isWhatsAppMention
      ? mentionTargets?.[numericId]
      : isTelegramMention
        ? token
        : undefined;
    const label = numericId
      ? `@${mentionNames?.[numericId] || "WhatsApp member"}`
      : token;

    if (target && onOpenMention) {
      content.push(
        <button
          key={`mention-${start}`}
          type="button"
          onClick={() => onOpenMention(target, label)}
          title={`Message ${label} privately`}
          aria-label={`Message ${label} privately`}
          className="rounded font-semibold underline decoration-current/30 underline-offset-2 transition-all duration-200 hover:decoration-current focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
        >
          {label}
        </button>,
      );
    } else {
      content.push(
        <span key={`mention-${start}`} className="font-semibold">
          {label}
        </span>,
      );
    }
    cursor = start + token.length;
  }

  if (!content.length) return text;
  if (cursor < text.length) content.push(text.slice(cursor));
  return content;
}

function MessageText({
  message,
  platform,
  mentionTargets,
  onOpenMention,
}: {
  message: MessageDTO;
  platform: Platform;
  mentionTargets?: Record<string, string>;
  onOpenMention?: (target: string, label: string) => void;
}) {
  const content: React.ReactNode[] = [];
  let cursor = 0;
  const resolvedMentionTargets = {
    ...(mentionTargets || {}),
    ...(message.mentionTargets || {}),
  };

  for (const match of message.body.matchAll(MESSAGE_URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailingPunctuation = url.match(TRAILING_URL_PUNCTUATION_RE)?.[0] || "";
    if (trailingPunctuation) url = url.slice(0, -trailingPunctuation.length);
    const urlLabel = compactUrlLabel(url);

    if (start > cursor) {
      content.push(
        <MentionText
          key={`text-${cursor}`}
          text={message.body.slice(cursor, start)}
          platform={platform}
          mentionNames={message.mentionNames}
          mentionTargets={resolvedMentionTargets}
          onOpenMention={onOpenMention}
        />,
      );
    }

    content.push(
      <a
        key={`url-${start}`}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        title={url}
        aria-label={`Open ${urlLabel} in a new tab`}
        className="inline-flex max-w-full items-center gap-1 align-bottom font-medium underline decoration-current/30 underline-offset-2 transition hover:decoration-current"
      >
        <span className="truncate">{urlLabel}</span>
        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
      </a>,
    );

    if (trailingPunctuation) content.push(trailingPunctuation);
    cursor = start + match[0].length;
  }

  if (cursor < message.body.length) {
    content.push(
      <MentionText
        key={`text-${cursor}`}
        text={message.body.slice(cursor)}
        platform={platform}
        mentionNames={message.mentionNames}
        mentionTargets={resolvedMentionTargets}
        onOpenMention={onOpenMention}
      />,
    );
  }

  return (
    <div className="min-w-0 whitespace-pre-wrap break-words">
      {content.length ? content : message.body}
    </div>
  );
}
import { Avatar } from "./Avatar";
import { ChatTypeIcon } from "./ChatTypeIcon";

import { ForwardModal } from "./ForwardModal";
import { EmojiPicker } from "./EmojiPicker";
import { PdfPreview } from "./PdfPreview";
import { KeywordAlertControl } from "./KeywordAlertControl";
import { ChatSearch } from "./ChatSearch";
import { WisprDictation } from "./WisprDictation";
import { appendDictation } from "@/lib/wispr-bridge";
import { chatSyncIssue, sourceChatUrl, syncHealthView, type SyncStatus } from "@/lib/sync-health";
import {
  ArchiveIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MoreIcon,
  PlusIcon,
  PaperclipIcon,
  PinIcon,
  ReplyIcon,
  SendIcon,
  SidebarIcon,
  SmileyIcon,
  SparklesIcon,
  ZapIcon,
} from "./icons";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

const CLIENT_SEND_TIMEOUT_MS = 18000;
const CLIENT_TRANSLATED_SEND_TIMEOUT_MS = 120000;
const CLIENT_BACKFILL_TIMEOUT_MS = 24000;
const EXTENDED_BACKFILL_TIMEOUT_MS = 75000;
const BACKFILL_OPTIONS = [
  { hours: 24, label: "Last 24 hours", detail: "Fast recent repair" },
  { hours: 72, label: "Last 72 hours", detail: "Recover the last 3 days" },
  { hours: 7 * 24, label: "Last 7 days", detail: "Recover a wider gap" },
  { hours: 30 * 24, label: "Last 30 days", detail: "Up to 500 available messages" },
  { hours: 0, label: "Earlier messages", detail: "Fetch the next older batch" },
] as const;
const AUTOCORRECT_STORAGE_KEY = "omnicrm-autocorrect-enabled-v1";
const MESSAGE_RUN_GAP_MS = 5 * 60 * 1000;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"] as const;
const THREAD_PAGE_SIZE = 50;
const THREAD_CACHE_LIMIT = 30;
const AUTO_TRANSLATION_BATCH_SIZE = 8;
const DELIVERY_REFRESH_DELAYS_MS = [
  250,
  500,
  500,
  750,
  1000,
  1000,
  1500,
  2000,
  3000,
  4000,
  8000,
  16000,
  32000,
] as const;

type AutoCorrectionNotice = {
  before: string;
  after: string;
  corrections: Array<{ from: string; to: string }>;
};

function autoCorrectionSummary(
  corrections: AutoCorrectionNotice["corrections"]
): string {
  const labels = corrections.map(({ from, to }) =>
    to === "fixed" ? "punctuation spacing" : `“${from}” → “${to}”`
  );
  if (!labels.length) return "Spelling corrected";
  if (labels.length <= 2) return labels.join(" · ");
  return `${labels.slice(0, 2).join(" · ")} · +${labels.length - 2} more`;
}

function containsMention(value: string): boolean {
  return /(?:^|\s)@[^\s@]*/u.test(value);
}
const TRANSLATION_LANGUAGES = [
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "tr", name: "Turkish" },
  { code: "hi", name: "Hindi" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
] as const;

type TranslationConfig = {
  enabled: boolean;
  languageCode: string | null;
  languageName: string | null;
  available: boolean | null;
  detail: string | null;
};

function mediaSource(message: MessageDTO): string | null {
  if (!message.mediaUrl) return null;
  if (
    message.mediaUrl.startsWith("blob:") ||
    message.mediaUrl.startsWith("data:")
  ) return message.mediaUrl;
  return `/api/messages/${encodeURIComponent(message.id)}/media?source=${encodeURIComponent(message.mediaUrl)}`;
}

function isPdf(message: MessageDTO): boolean {
  if (message.mediaType !== "file") return false;
  return [message.mediaName, message.mediaUrl].some((value) =>
    (value || "").split(/[?#]/)[0].toLowerCase().endsWith(".pdf")
  );
}

function downloadSource(source: string): string {
  if (source.startsWith("blob:") || source.startsWith("data:")) return source;
  return `${source}${source.includes("?") ? "&" : "?"}download=1`;
}

type ThreadPage = { messages: MessageDTO[]; hasMore: boolean };

const threadCache = new Map<string, ThreadPage>();
const threadPrefetches = new Map<string, Promise<boolean>>();

function cacheThread(conversationId: string, page: ThreadPage): void {
  threadCache.delete(conversationId);
  threadCache.set(conversationId, {
    messages: mergeMessageWindow([], page.messages).slice(-150),
    hasMore: page.hasMore,
  });
  while (threadCache.size > THREAD_CACHE_LIMIT) {
    const oldest = threadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    threadCache.delete(oldest);
  }
}

export function prefetchConversationMessages(conversationId: string): Promise<boolean> {
  if (threadCache.has(conversationId)) return Promise.resolve(true);
  const existing = threadPrefetches.get(conversationId);
  if (existing) return existing;

  const request = fetch(
    `/api/conversations/${conversationId}/messages?limit=${THREAD_PAGE_SIZE}`
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("Conversation prefetch failed");
      const page = (await response.json()) as ThreadPage;
      cacheThread(conversationId, page);
      return true;
    })
    .catch(() => false)
    .finally(() => threadPrefetches.delete(conversationId));
  threadPrefetches.set(conversationId, request);
  return request;
}

export function ChatThread({
  conversation,
  snippets,
  onManageSnippets,
  onSent,
  onMarkDone,
  onArchiveAndMute,
  archiveAndMutePending = false,
  onOpenContact,
  readOnly = false,
  topics,
  onSelectTopic,
  focusMessageId,
  compactMessageLimit,
  onBack,
  onOpenTaggedPerson,
  onOpenConversation,
  multiViewAction,
  multiViewCompact = false,
  syncStatus,
}: {
  conversation: ConversationDTO;
  syncStatus?: SyncStatus;
  snippets: SnippetDTO[];
  onManageSnippets: () => void;
  onSent: (preview: string) => void;
  onMarkDone?: () => void;
  onArchiveAndMute?: () => void;
  archiveAndMutePending?: boolean;
  onOpenContact: () => void;
  readOnly?: boolean;
  // Sibling forum topics shown as tabs above the thread (for forum channels).
  topics?: { id: string; name: string; unread: number }[];
  onSelectTopic?: (id: string) => void;
  focusMessageId?: string | null;
  // Recap mode can show only the newest messages until the user asks for the
  // full thread. The normal inbox leaves this undefined and behaves unchanged.
  compactMessageLimit?: number;
  onBack?: () => void;
  onOpenTaggedPerson?: (target: TaggedPersonTarget) => void;
  onOpenConversation?: (conversationId: string) => void;
  multiViewAction?: {
    label: string;
    kind: "pin" | "unpin" | "close";
    onClick: () => void;
  };
  multiViewCompact?: boolean;
}) {
  const initialCachedThread = focusMessageId
    ? undefined
    : threadCache.get(conversation.id);
  const [messages, setMessages] = useState<MessageDTO[]>(
    () => initialCachedThread?.messages ?? []
  );
  const [loading, setLoading] = useState(!initialCachedThread);
  const [hasMore, setHasMore] = useState(initialCachedThread?.hasMore ?? false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [draft, setDraft] = useState(() =>
    loadConversationDraft(conversation.id)
  );
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [autoCorrectEnabled, setAutoCorrectEnabled] = useState(true);
  const [autoCorrecting, setAutoCorrecting] = useState(false);
  const [autoCorrectionNotice, setAutoCorrectionNotice] =
    useState<AutoCorrectionNotice | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessageDTO | null>(null);
  const [calcom, setCalcom] = useState<{ enabled: boolean; link: string }>({
    enabled: false,
    link: "",
  });
  const [calDismissed, setCalDismissed] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMemberProfile[]>([]);
  const [memberProfile, setMemberProfile] =
    useState<GroupMemberProfile | null>(null);
  const [memberConversation, setMemberConversation] =
    useState<DirectConversationPreview | null>(null);
  const [memberConversationLoading, setMemberConversationLoading] =
    useState(false);
  const [memberConversationError, setMemberConversationError] =
    useState<string | null>(null);
  const [openingMemberConversation, setOpeningMemberConversation] =
    useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [spotlightImage, setSpotlightImage] = useState<string | null>(null);
  const [spotlightVideo, setSpotlightVideo] = useState<{
    url: string;
    name: string;
    isGif?: boolean;
  } | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MessageDTO | null>(null);
  const [replyFocus, setReplyFocus] = useState<{
    id: string;
    token: number;
    source?: "search";
  } | null>(null);
  const [replyJumpingId, setReplyJumpingId] = useState<string | null>(null);
  const [replyJumpErrorId, setReplyJumpErrorId] = useState<string | null>(null);
  const [showFullContext, setShowFullContext] = useState(false);
  const [backfillState, setBackfillState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [backfillMessage, setBackfillMessage] = useState("");
  const [showBackfillMenu, setShowBackfillMenu] = useState(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [recoveringMediaId, setRecoveringMediaId] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [pinningMessageId, setPinningMessageId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<{
    messageId: string;
    message: string;
  } | null>(null);
  const [reactionError, setReactionError] = useState<{
    messageId: string;
    message: string;
  } | null>(null);
  const [translationConfig, setTranslationConfig] = useState<TranslationConfig>({
    enabled: conversation.translationEnabled,
    languageCode: conversation.translationLanguageCode,
    languageName: conversation.translationLanguageName,
    available: null,
    detail: null,
  });
  const [showTranslationMenu, setShowTranslationMenu] = useState(false);
  const [savingTranslation, setSavingTranslation] = useState(false);
  const [translationSettingsError, setTranslationSettingsError] = useState<string | null>(null);
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  const [autoTranslatingIds, setAutoTranslatingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [autoTranslationQueueTick, setAutoTranslationQueueTick] = useState(0);
  const [translationMessageError, setTranslationMessageError] = useState<{
    messageId: string;
    message: string;
  } | null>(null);
  const [shownTranslations, setShownTranslations] = useState<Set<string>>(
    () => new Set()
  );
  const notifiedSentRef = useRef(new Set<string>());
  const sendInFlightRef = useRef(false);
  const backfillAbortRef = useRef<AbortController | null>(null);
  const backfillMenuRef = useRef<HTMLDivElement | null>(null);
  const autoTranslationAbortRef = useRef<AbortController | null>(null);
  const autoTranslationRunningRef = useRef(false);
  const autoTranslationAttemptedRef = useRef(new Set<string>());
  const translationConversationRef = useRef(conversation.id);
  const activeFocusMessageId = replyFocus?.id ?? focusMessageId ?? null;
  const activeFocusMessageIdRef = useRef(activeFocusMessageId);

  useEffect(() => {
    activeFocusMessageIdRef.current = activeFocusMessageId;
  }, [activeFocusMessageId]);

  useEffect(() => {
    setReplyFocus(null);
    setReplyJumpingId(null);
    setReplyJumpErrorId(null);
  }, [conversation.id, focusMessageId]);

  useEffect(() => {
    setDraft(loadConversationDraft(conversation.id));
    setAutoCorrectionNotice(null);
  }, [conversation.id]);

  useEffect(() => {
    const saved = window.localStorage.getItem(AUTOCORRECT_STORAGE_KEY);
    if (saved !== null) setAutoCorrectEnabled(saved !== "false");
  }, []);

  const pendingDraftRef = useRef({ id: conversation.id, text: draft });
  useEffect(() => {
    pendingDraftRef.current = { id: conversation.id, text: draft };
    const timer = window.setTimeout(
      () => saveConversationDraft(conversation.id, draft),
      300
    );
    return () => window.clearTimeout(timer);
  }, [conversation.id, draft]);

  // Closing a pane can unmount it before the debounce fires. Flush the latest
  // unsent text so reopening the conversation never loses that last edit.
  useEffect(() => () => {
    const pending = pendingDraftRef.current;
    saveConversationDraft(pending.id, pending.text);
  }, []);
  const deliveryRefreshTimersRef = useRef(new Set<number>());
  const deliveryMessagesRef = useRef(messages);
  deliveryMessagesRef.current = messages;
  const activeDeliveryConversationRef = useRef(conversation.id);
  activeDeliveryConversationRef.current = conversation.id;
  const dragDepthRef = useRef(0);
  const onSentRef = useRef(onSent);
  const discordBotChat =
    conversation.platform === "discord" && conversation.account?.driver === "bot";
  const discordSearchChat = conversation.platform === "discord" && conversation.account?.driver === "personal-readonly";
  const canSyncConversation = conversation.platform !== "discord" || discordBotChat || discordSearchChat;
  const historyIssue = chatSyncIssue(conversation.externalId, syncStatus?.sync);
  const nativeChatUrl = sourceChatUrl(conversation);
  const syncDelayed = syncStatus && (syncStatus.state !== "ready" || (syncStatus.sync?.retryAt || 0) > Date.now() || Boolean(syncStatus.sync?.lastCheckedAt && Date.now() - syncStatus.sync.lastCheckedAt > 15 * 60_000));
  const historyLabel = syncDelayed ? "Sync delayed" : historyIssue?.state === "blocked" ? "History delayed" : historyIssue || conversation.previewOnly ? "History pending" : "History";
  const canReactConversation =
    !readOnly &&
    (conversation.platform === "telegram" ||
      conversation.platform === "whatsapp" ||
      discordBotChat);
  const discordArchiveLinks =
    conversation.platform === "discord" &&
    !discordBotChat &&
    conversation.externalId &&
    /^\d+$/.test(conversation.externalId)
      ? {
          app: `discord://-/channels/@me/${conversation.externalId}`,
          web: `https://discord.com/channels/@me/${conversation.externalId}`,
        }
      : null;

  useEffect(() => {
    onSentRef.current = onSent;
  }, [onSent]);

  useEffect(() => () => {
    backfillAbortRef.current?.abort();
    autoTranslationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!showBackfillMenu) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!backfillMenuRef.current?.contains(event.target as Node)) {
        setShowBackfillMenu(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowBackfillMenu(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showBackfillMenu]);

  useEffect(() => () => {
    for (const timer of deliveryRefreshTimersRef.current)
      window.clearTimeout(timer);
    deliveryRefreshTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!spotlightImage && !spotlightVideo && !pdfPreview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSpotlightImage(null);
        setSpotlightVideo(null);
        setPdfPreview(null);
      }
    };
    window.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = previous;
    };
  }, [pdfPreview, spotlightImage, spotlightVideo]);

  useEffect(() => {
    if (!reactionPickerMessageId) return;
    const closePicker = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-reaction-picker]")) {
        setReactionPickerMessageId(null);
      }
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [reactionPickerMessageId]);

  useEffect(() => {
    translationConversationRef.current = conversation.id;
    autoTranslationAbortRef.current?.abort();
    autoTranslationAbortRef.current = null;
    autoTranslationRunningRef.current = false;
    autoTranslationAttemptedRef.current.clear();
    setAutoTranslatingIds(new Set());
    setAutoTranslationQueueTick(0);
    setShowTranslationMenu(false);
    setTranslationSettingsError(null);
    setTranslationMessageError(null);
    setShownTranslations(new Set());
    setTranslationConfig({
      enabled: conversation.translationEnabled,
      languageCode: conversation.translationLanguageCode,
      languageName: conversation.translationLanguageName,
      available: null,
      detail: null,
    });
    const controller = new AbortController();
    fetch(`/api/conversations/${conversation.id}/translation`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Translation settings unavailable");
        return response.json() as Promise<{
          translationEnabled: boolean;
          translationLanguageCode: string | null;
          translationLanguageName: string | null;
          available: boolean;
          detail?: string;
        }>;
      })
      .then((data) =>
        setTranslationConfig({
          enabled: data.translationEnabled,
          languageCode: data.translationLanguageCode,
          languageName: data.translationLanguageName,
          available: data.available,
          detail: data.detail || null,
        })
      )
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setTranslationConfig((current) => ({ ...current, available: false }));
      });
    return () => controller.abort();
  }, [
    conversation.id,
    conversation.translationEnabled,
    conversation.translationLanguageCode,
    conversation.translationLanguageName,
  ]);

  useEffect(() => {
    if (!showTranslationMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-translation-menu]")) setShowTranslationMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [showTranslationMenu]);

  useEffect(() => {
    if (!showTranslationMenu || translationConfig.available !== false) return;
    const controller = new AbortController();
    const refreshLocalEngine = async () => {
      try {
        const response = await fetch(`/api/conversations/${conversation.id}/translation`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { available?: boolean; detail?: string };
        setTranslationConfig((current) => ({
          ...current,
          available: Boolean(data.available),
          detail: data.detail || current.detail,
        }));
      } catch {
        // The normal chat-change refresh remains the fallback.
      }
    };
    void refreshLocalEngine();
    const timer = window.setInterval(refreshLocalEngine, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [conversation.id, showTranslationMenu, translationConfig.available]);

  useEffect(() => {
    if (
      translationConversationRef.current !== conversation.id ||
      !translationConfig.enabled ||
      translationConfig.available !== true ||
      savingTranslation ||
      autoTranslationRunningRef.current
    ) return;

    const pending = messages.filter(
      (message) =>
        message.direction === "in" &&
        Boolean(message.body.trim()) &&
        !message.translatedBody &&
        !message.id.startsWith("client_") &&
        !autoTranslationAttemptedRef.current.has(message.id)
    );
    if (!pending.length) return;

    // Start with the newest messages so the conversation a user just opened
    // becomes readable first, then progressively work back through the thread.
    const batch = pending.slice(-AUTO_TRANSLATION_BATCH_SIZE);
    const messageIds = batch.map((message) => message.id);
    for (const id of messageIds) autoTranslationAttemptedRef.current.add(id);

    const controller = new AbortController();
    autoTranslationAbortRef.current = controller;
    autoTranslationRunningRef.current = true;
    setAutoTranslatingIds((current) => {
      const next = new Set(current);
      for (const id of messageIds) next.add(id);
      return next;
    });

    void fetch(`/api/conversations/${conversation.id}/translation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          messages?: Array<{
            id: string;
            translatedBody: string | null;
            translationSourceLanguage: string | null;
            translationTargetLanguage: string | null;
          }>;
          errors?: Array<{ id: string; error: string }>;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Automatic translation could not finish.");
        if (translationConversationRef.current !== conversation.id) return;

        const translatedById = new Map(
          (data.messages || []).map((message) => [message.id, message] as const)
        );
        if (translatedById.size) {
          setMessages((current) =>
            current.map((message) => {
              const translated = translatedById.get(message.id);
              return translated
                ? {
                    ...message,
                    translatedBody: translated.translatedBody,
                    translationSourceLanguage: translated.translationSourceLanguage,
                    translationTargetLanguage: translated.translationTargetLanguage,
                  }
                : message;
            })
          );
        }
        const firstError = data.errors?.[0];
        if (firstError) {
          setTranslationMessageError({
            messageId: firstError.id,
            message: `${firstError.error} Press the globe to retry.`,
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || translationConversationRef.current !== conversation.id) return;
        setTranslationMessageError({
          messageId: messageIds[messageIds.length - 1],
          message:
            error instanceof Error
              ? `${error.message} Press the globe to retry.`
              : "Automatic translation could not finish. Press the globe to retry.",
        });
      })
      .finally(() => {
        if (autoTranslationAbortRef.current !== controller) return;
        autoTranslationAbortRef.current = null;
        autoTranslationRunningRef.current = false;
        setAutoTranslatingIds((current) => {
          const next = new Set(current);
          for (const id of messageIds) next.delete(id);
          return next;
        });
        setAutoTranslationQueueTick((current) => current + 1);
      });
  }, [
    autoTranslationQueueTick,
    conversation.id,
    messages,
    savingTranslation,
    translationConfig.available,
    translationConfig.enabled,
  ]);

  useEffect(() => {
    const read = () => setCalcom(loadSettings().plugins.calcom);
    read();
    window.addEventListener("tmd-settings", read);
    return () => window.removeEventListener("tmd-settings", read);
  }, []);

  // Most recent message that mentions a date — drives the Cal.com suggestion.
  const dateMsg = useMemo(() => {
    if (!calcom.enabled || !calcom.link.trim()) return null;
    for (let i = messages.length - 1; i >= Math.max(0, messages.length - 12); i--) {
      if (mentionsDate(messages[i].body)) return messages[i];
    }
    return null;
  }, [messages, calcom]);

  function insertCalLink() {
    const url = calcomUrl(calcom.link, conversation.contact);
    if (!url) return;
    insertText(`Want to grab a time? Here's my calendar: ${url}`, true);
    setCalDismissed(dateMsg?.id ?? null);
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const loadedConversationIdRef = useRef<string | null>(
    initialCachedThread ? conversation.id : null,
  );
  const initialScrolledConversationIdRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const autocorrectAbortRef = useRef<AbortController | null>(null);
  const lastAutocorrectedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    autocorrectAbortRef.current?.abort();
    autocorrectAbortRef.current = null;
    lastAutocorrectedDraftRef.current = null;
    setAutoCorrecting(false);
  }, [conversation.id]);

  useEffect(() => {
    draftRef.current = draft;
    if (autoCorrectionNotice && draft !== autoCorrectionNotice.after) {
      setAutoCorrectionNotice(null);
    }
  }, [autoCorrectionNotice, draft]);

  useEffect(() => {
    if (
      !autoCorrectEnabled ||
      readOnly ||
      containsMention(draft) ||
      draft.trim().length < 3 ||
      draft === lastAutocorrectedDraftRef.current
    ) {
      return;
    }

    const requestedDraft = draft;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      autocorrectAbortRef.current?.abort();
      autocorrectAbortRef.current = controller;
      setAutoCorrecting(true);
      try {
        const response = await fetch("/api/ai-replies/autocorrect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: requestedDraft }),
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => ({}))) as {
          text?: string;
          changed?: boolean;
          corrections?: Array<{ from: string; to: string }>;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "Autocorrect unavailable");
        if (
          controller.signal.aborted ||
          draftRef.current !== requestedDraft ||
          !result.changed ||
          typeof result.text !== "string" ||
          result.text === requestedDraft
        ) {
          return;
        }

        const selectionStart = textareaRef.current?.selectionStart ?? requestedDraft.length;
        const hadFocus = document.activeElement === textareaRef.current;
        const correctedDraft = result.text;
        lastAutocorrectedDraftRef.current = correctedDraft;
        draftRef.current = correctedDraft;
        setDraft(correctedDraft);
        setComposerNotice(null);
        setAutoCorrectionNotice({
          before: requestedDraft,
          after: correctedDraft,
          corrections: result.corrections || [],
        });
        if (hadFocus) {
          const nextCursor = Math.max(
            0,
            Math.min(
              correctedDraft.length,
              selectionStart + correctedDraft.length - requestedDraft.length
            )
          );
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setComposerNotice("Local autocorrect is unavailable · your draft was not changed");
      } finally {
        if (autocorrectAbortRef.current === controller) {
          autocorrectAbortRef.current = null;
          setAutoCorrecting(false);
        }
      }
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [autoCorrectEnabled, conversation.id, draft, readOnly]);

  useEffect(
    () => () => {
      autocorrectAbortRef.current?.abort();
    },
    []
  );

  function scrollToLatest() {
    setReplyFocus(null);
    const element = scrollRef.current;
    if (!element) return;
    nearBottomRef.current = true;
    setShowScrollToLatest(false);
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }

  const caps = PLATFORM_ATTACHMENTS[conversation.platform];
  const timeline = useMemo(
    () => projectMessageTimeline(messages, conversation.platform),
    [messages, conversation.platform],
  );
  const renderedFocusMessageId = activeFocusMessageId
    ? timeline.aliases.get(activeFocusMessageId) ?? activeFocusMessageId
    : null;
  const visibleMessages = useMemo(
    () =>
      compactMessageLimit && !showFullContext
        ? timeline.messages.slice(-compactMessageLimit)
        : timeline.messages,
    [compactMessageLimit, timeline.messages, showFullContext]
  );
  const compactHiddenCount = Math.max(0, timeline.messages.length - visibleMessages.length);
  const messagesByExternalKey = useMemo(
    () => new Map(messages.filter(message => message.externalKey).map(message => [message.externalKey, message])),
    [messages],
  );

  // A chat's initial position must be set after its messages commit to the DOM.
  // Scrolling inside the fetch callback races React and can measure the empty
  // thread, which leaves a newly selected conversation at the top.
  useLayoutEffect(() => {
    if (
      loading ||
      loadedConversationIdRef.current !== conversation.id ||
      initialScrolledConversationIdRef.current === conversation.id
    ) {
      return;
    }
    initialScrolledConversationIdRef.current = conversation.id;
    if (focusMessageId) return;

    const scrollToLatest = () => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
      nearBottomRef.current = true;
      setShowScrollToLatest(false);
    };
    scrollToLatest();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      scrollToLatest();
      secondFrame = requestAnimationFrame(scrollToLatest);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [conversation.id, focusMessageId, loading, visibleMessages.length]);

  useEffect(() => {
    if (focusMessageId || typeof ResizeObserver === "undefined") return;
    const content = messageContentRef.current;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      if (!nearBottomRef.current) return;
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversation.id, focusMessageId]);

  useEffect(() => setShowFullContext(false), [conversation.id]);

  useEffect(() => setShowScrollToLatest(false), [conversation.id]);

  useEffect(() => {
    setAttachment(null);
    setAttachmentUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [conversation.id]);

  useEffect(() => {
    if (loading || focusMessageId) return;
    cacheThread(conversation.id, { messages, hasMore });
  }, [conversation.id, focusMessageId, hasMore, loading, messages]);

  useEffect(() => {
    if (!conversation.isGroup) return setGroupMembers([]);
    fetch(`/api/conversations/${conversation.id}/members`)
      .then((r) => r.json()).then(setGroupMembers).catch(() => setGroupMembers([]));
  }, [conversation.id, conversation.isGroup]);

  useEffect(() => setMemberProfile(null), [conversation.id]);

  useEffect(() => {
    setMemberConversation(null);
    setMemberConversationError(null);
    setOpeningMemberConversation(false);
    if (!memberProfile) {
      setMemberConversationLoading(false);
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ platform: conversation.platform });
    if (conversation.account?.id) query.set("accountId", conversation.account.id);
    setMemberConversationLoading(true);
    fetch(
      `/api/contacts/${encodeURIComponent(memberProfile.id)}/direct-conversation?${query}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          conversation?: DirectConversationPreview | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Could not load the private conversation.");
        }
        setMemberConversation(payload.conversation ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMemberConversationError(
          error instanceof Error
            ? error.message
            : "Could not load the private conversation.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setMemberConversationLoading(false);
      });

    return () => controller.abort();
  }, [conversation.account?.id, conversation.platform, memberProfile]);

  useEffect(() => {
    if (!memberProfile) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest("[data-member-profile]") &&
        !target?.closest("[data-member-trigger]")
      ) {
        setMemberProfile(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMemberProfile(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [memberProfile]);

  function openSenderProfile(message: MessageDTO) {
    if (!conversation.isGroup || message.direction === "out") return;
    const saved = groupMembers.find(
      (member) => member.id === message.senderContactId,
    );
    setMemberProfile(
      saved || {
        id: message.senderContactId || message.id,
        name: message.senderName || "Group member",
        handle: message.senderHandle || "",
        externalKey: message.senderExternalKey || null,
        avatarUrl: message.senderAvatarUrl || null,
        company: null,
        email: null,
        phone: null,
        tags: message.senderTags || [],
      },
    );
  }

  async function openOrStartMemberConversation(member: GroupMemberProfile) {
    if (!onOpenConversation || openingMemberConversation) return;
    if (memberConversation && (conversation.platform !== "whatsapp" || memberConversation.messages.length > 0)) {
      setMemberProfile(null);
      onOpenConversation(memberConversation.id);
      return;
    }
    if (
      !member.externalKey ||
      !conversation.account?.id ||
      (conversation.platform !== "telegram" && conversation.platform !== "whatsapp")
    ) {
      setMemberConversationError("Private messaging is unavailable for this member.");
      return;
    }

    setOpeningMemberConversation(true);
    setMemberConversationError(null);
    try {
      const response = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: conversation.platform,
          accountId: conversation.account.id,
          target: member.externalKey,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        conversationId?: string;
        error?: string;
      };
      if (!response.ok || !payload.conversationId) {
        throw new Error(payload.error || "Could not open the private conversation.");
      }
      setMemberProfile(null);
      onOpenConversation(payload.conversationId);
    } catch (error) {
      setMemberConversationError(
        error instanceof Error
          ? error.message
          : "Could not open the private conversation.",
      );
    } finally {
      setOpeningMemberConversation(false);
    }
  }

  const mentionMatch = conversation.isGroup ? /(?:^|\s)@([^\s@]*)$/.exec(draft) : null;
  const mentionQuery = mentionMatch?.[1].toLowerCase() ?? "";
  const mentionResults = mentionMatch ? groupMembers.filter((member) =>
    member.name.toLowerCase().includes(mentionQuery) ||
    member.handle.toLowerCase().replace(/^@/, "").includes(mentionQuery)
  ).slice(0, 8) : [];
  const mentionTargets = useMemo(
    () =>
      Object.fromEntries(
        groupMembers.flatMap((member) => {
          const external = member.externalKey?.replace(/^whatsapp:/, "") || "";
          const id = external.match(/^(\d+)@(?:c\.us|s\.whatsapp\.net|lid)$/)?.[1];
          return id ? [[id, external] as const] : [];
        }),
      ),
    [groupMembers],
  );
  useEffect(() => setMentionIndex(0), [mentionQuery]);

  function pickMention(member: typeof groupMembers[number]) {
    const start = mentionMatch?.index ?? draft.length;
    const prefix = draft.slice(0, start) + (mentionMatch?.[0].startsWith(" ") ? " " : "");
    const external = member.externalKey?.replace(/^whatsapp:/, "") || "";
    const token = conversation.platform === "whatsapp"
      ? `@${external.replace(/@.*$/, "")}`
      : member.handle.startsWith("@") ? member.handle : `@${member.handle || member.name.replace(/\s+/g, "")}`;
    const nextDraft = `${prefix}${token} `;
    autocorrectAbortRef.current?.abort();
    autocorrectAbortRef.current = null;
    draftRef.current = nextDraft;
    lastAutocorrectedDraftRef.current = null;
    setAutoCorrecting(false);
    setAutoCorrectionNotice(null);
    setDraft(nextDraft);
    setComposerNotice("Mention added · keep typing or press Enter again to send");
    if (conversation.platform === "whatsapp" && external)
      setSelectedMentions((items) => items.includes(external) ? items : [...items, external]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function copyEmail(email: string, messageId: string) {
    await navigator.clipboard.writeText(email);
    setCopiedEmail(`${messageId}:${email}`);
    fetch("/api/email-captures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, messageId, conversationId: conversation.id }),
    }).catch(() => {});
    setTimeout(() => setCopiedEmail(null), 1400);
  }

  // "/" slash menu: open when the draft is a lone "/token" (no spaces).
  const slashMatch = /^\/(\S*)$/.exec(draft);
  const slashOpen = slashMatch !== null;
  const slashQuery = slashMatch?.[1].toLowerCase() ?? "";
  const slashResults = useMemo(
    () =>
      slashOpen
        ? snippets.filter(
            (s) =>
              s.title.toLowerCase().includes(slashQuery) ||
              s.text.toLowerCase().includes(slashQuery)
          )
        : [],
    [slashOpen, slashQuery, snippets]
  );
  const [slashIndex, setSlashIndex] = useState(0);
  useEffect(() => setSlashIndex(0), [slashQuery, slashOpen]);

  // Insert text at the cursor (or replace the whole draft for slash snippets).
  function insertText(text: string, replaceAll = false) {
    const ta = textareaRef.current;
    if (!ta || replaceAll) {
      setDraft(text);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(text.length, text.length);
      });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setDraft(draft.slice(0, start) + text + draft.slice(end));
    requestAnimationFrame(() => {
      const pos = start + text.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function insertSnippet(s: SnippetDTO, replaceAll = false) {
    insertText(s.text, replaceAll);
  }

  async function generateAiDraft() {
    if (aiDrafting) return;
    setAiDrafting(true);
    setAiDraftError(null);
    setComposerNotice(null);
    try {
      const response = await fetch("/api/ai-replies/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          seedDraft: draft.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        draft?: string;
        examplesUsed?: number;
        source?: "proven_reply" | "composed" | "needs_confirmation";
        error?: string;
      };
      if (!response.ok || !data.draft) {
        throw new Error(data.error || "A reply could not be drafted.");
      }
      setDraft(data.draft);
      setComposerNotice(
        data.source === "needs_confirmation"
          ? "An unverified fact was held back. Review before sending."
          : data.source === "proven_reply"
          ? "Your proven answer was reused. Review before sending."
          : data.examplesUsed
            ? `AI draft added using ${data.examplesUsed} close ${data.examplesUsed === 1 ? "match" : "matches"}. Review before sending.`
          : "AI draft added. Review before sending."
      );
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(data.draft!.length, data.draft!.length);
      });
    } catch (error) {
      setAiDraftError(
        error instanceof Error ? error.message : "A reply could not be drafted."
      );
    } finally {
      setAiDrafting(false);
    }
  }

  function pickFile(file: File | null) {
    setAttachError(null);
    if (!file) return;
    const type = mimeToMediaType(file.type);
    if (!caps.types.includes(type)) {
      setAttachError(
        `${PLATFORMS[conversation.platform].label} can't send this file type. ${caps.hint}.`
      );
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setAttachError("File is over the 25 MB limit.");
      return;
    }
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    setAttachment(file);
    setAttachmentUrl(URL.createObjectURL(file));
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (readOnly || !canSyncConversation || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (readOnly || !canSyncConversation || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!event.dataTransfer.files.length) return;
    if (readOnly || !canSyncConversation) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1) {
      setAttachError("Send one attachment at a time.");
      return;
    }
    pickFile(files[0] || null);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    if (files.length > 1) {
      setAttachError("Paste one attachment at a time.");
      return;
    }
    pickFile(files[0]);
  }

  function clearAttachment() {
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    setAttachment(null);
    setAttachmentUrl(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    let active = true;
    backfillAbortRef.current?.abort();
    backfillAbortRef.current = null;
    notifiedSentRef.current.clear();
    const cached = focusMessageId ? undefined : threadCache.get(conversation.id);
    loadedConversationIdRef.current = cached ? conversation.id : null;
    setLoading(!cached);
    setMessages(cached?.messages ?? []);
    setHasMore(cached?.hasMore ?? false);
    setBackfillState("idle");
    setBackfillMessage("");
    setShowBackfillMenu(false);
    setReactionPickerMessageId(null);
    setReactingMessageId(null);
    setReactionError(null);
    setDragActive(false);
    dragDepthRef.current = 0;

    const initial = () =>
      fetch(
        `/api/conversations/${conversation.id}/messages?limit=${THREAD_PAGE_SIZE}&markRead=1${
          focusMessageId ? `&focus=${encodeURIComponent(focusMessageId)}` : ""
        }`
      )
        .then((response) => {
          if (!response.ok) throw new Error("Conversation could not load");
          return response.json();
        })
        .then((data: { messages: MessageDTO[]; hasMore: boolean }) => {
          if (active) {
            loadedConversationIdRef.current = conversation.id;
            setMessages(current => mergeMessageWindow(current, data.messages));
            setHasMore(data.hasMore);
            if (!focusMessageId) cacheThread(conversation.id, data);
            for (const message of data.messages) {
              if (message.deliveryStatus === "sent")
                notifiedSentRef.current.add(message.id);
            }
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) setLoading(false);
        });

    initial();
    const poll = () => {
      // Delivery updates mutate an existing row, so an `after=createdAt` poll
      // cannot see them. Refresh the latest window and merge by stable id.
      const ids = encodeURIComponent(deliveryIds(deliveryMessagesRef.current).join(","));
      const observed = encodeURIComponent(observedMessageIds(deliveryMessagesRef.current).join(","));
      fetch(`/api/conversations/${conversation.id}/messages?limit=40&deliveryIds=${ids}&observedIds=${observed}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { messages: MessageDTO[]; deliveries?: MessageDTO[]; missingObservedIds?: string[] }) => {
          if (!active || !data.messages) return;
          const updates = [...data.messages, ...(data.deliveries || [])];
          for (const candidate of updates) {
            if (
              candidate.deliveryStatus === "sent" &&
              candidate.id.startsWith("client_") &&
              !notifiedSentRef.current.has(candidate.id)
            ) {
              notifiedSentRef.current.add(candidate.id);
              setAttachError(null);
              onSentRef.current(
                candidate.body ||
                  (candidate.mediaType ? MEDIA_LABEL[candidate.mediaType] : "Message")
              );
            }
          }
          setMessages((current) => {
            const receipts = new Map((data.deliveries || []).map(message => [message.id, message]));
            return orderMessageWindow(mergeMessageWindow(removeMissingMessages(current, data.missingObservedIds), data.messages).map(message => {
              const receipt = receipts.get(message.id);
              return receipt ? mergeDeliveryReceipt(message, receipt) : message;
            }));
          });
          // A notification deep-link owns the scroll position. Do not let the
          // background poll pull the user back to the newest message while the
          // matched message is being revealed.
          if (!activeFocusMessageIdRef.current && nearBottomRef.current)
            requestAnimationFrame(() =>
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
            );
        })
        .catch(() => {});
    };
    const t = setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, 3000);
    return () => {
      active = false;
      clearInterval(t);
      backfillAbortRef.current?.abort();
      backfillAbortRef.current = null;
    };
  }, [conversation.id, focusMessageId]);

  useEffect(() => {
    if (!renderedFocusMessageId || loading) return;
    const message = scrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(renderedFocusMessageId)}"]`,
    );
    if (!message) return;

    // Large Telegram groups can have hundreds of rendered messages. An
    // immediate jump makes the highlighted result visible right away, while a
    // second pass keeps it centered after media and names finish laying out.
    const centerMessage = () =>
      message.scrollIntoView({ block: "center", behavior: "auto" });
    centerMessage();
    const frame = requestAnimationFrame(centerMessage);
    const settle = window.setTimeout(centerMessage, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [renderedFocusMessageId, loading, visibleMessages.length, replyFocus?.token]);

  async function jumpToSearchMessage(id: string, signal: AbortSignal) {
    if (!messages.some((message) => message.id === id)) {
      const response = await fetch(
        `/api/conversations/${conversation.id}/messages?limit=${THREAD_PAGE_SIZE}&focus=${encodeURIComponent(id)}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error("Message could not load");
      const data = await response.json() as ThreadPage & { focusedMessageId?: string | null };
      if (signal.aborted) return;
      if (data.focusedMessageId !== id) throw new Error("Message is no longer available");
      setMessages(data.messages);
      setHasMore(data.hasMore);
    }
    if (signal.aborted) return;
    nearBottomRef.current = false;
    activeFocusMessageIdRef.current = id;
    setShowFullContext(true);
    setReplyFocus({ id, token: Date.now(), source: "search" });
  }

  async function jumpToRepliedMessage(message: MessageDTO) {
    if (!message.replyToExternalKey || replyJumpingId) return;
    setReplyJumpingId(message.id);
    setReplyJumpErrorId(null);
    try {
      let targetId = messages.find(
        (candidate) => candidate.externalKey === message.replyToExternalKey,
      )?.id;

      if (!targetId) {
        const response = await fetch(
          `/api/conversations/${conversation.id}/messages?limit=${THREAD_PAGE_SIZE}&focusExternalKey=${encodeURIComponent(message.replyToExternalKey)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Original message could not load");
        const data = (await response.json()) as ThreadPage & {
          focusedMessageId?: string | null;
        };
        targetId = data.focusedMessageId ?? undefined;
        if (!targetId) throw new Error("Original message is not in synced history");
        setMessages(data.messages);
        setHasMore(data.hasMore);
      }

      setReplyFocus({ id: targetId, token: Date.now() });
    } catch {
      setReplyJumpErrorId(message.id);
    } finally {
      setReplyJumpingId(null);
    }
  }

  async function loadOlder() {
    const first = orderMessageWindow(messages).find((m) => m.deliveryStatus !== "sending");
    if (!first || loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const oldHeight = el?.scrollHeight || 0;
    const data = await fetch(
      `/api/conversations/${conversation.id}/messages?before=${encodeURIComponent(first.createdAt)}&limit=${THREAD_PAGE_SIZE}`
    ).then((r) => r.json()) as { messages: MessageDTO[]; hasMore: boolean };
    setMessages((current) => mergeMessageWindow(current, data.messages));
    setHasMore(data.hasMore);
    setLoadingOlder(false);
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - oldHeight;
    });
  }

  async function refreshMessagesAfterBackfill(signal?: AbortSignal) {
    const response = await fetch(
      `/api/conversations/${conversation.id}/messages?limit=100`,
      { signal }
    );
    if (!response.ok) throw new Error("Messages were recovered, but the chat could not refresh.");
    const data = await response.json() as { messages: MessageDTO[]; hasMore: boolean };
    if (signal?.aborted) throw new DOMException("Backfill canceled", "AbortError");
    setMessages((current) => {
      const serverIds = new Set(data.messages.map((message) => message.id));
      const temporaryMessages = current.filter(
        (message) => deliveryIds([message]).length > 0 && !serverIds.has(message.id)
      );
      return temporaryMessages.length
        ? [...data.messages, ...temporaryMessages]
        : data.messages;
    });
    setHasMore(data.hasMore);
    return data.messages;
  }

  async function backfillMessages(hours: number) {
    if (backfillState === "loading") return;
    const option = BACKFILL_OPTIONS.find((item) => item.hours === hours);
    const rangeLabel = option?.label || "Chat history";
    const controller = new AbortController();
    backfillAbortRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort("timeout"),
      conversation.platform === "x" ? 130_000 : hours > 24 ? EXTENDED_BACKFILL_TIMEOUT_MS : CLIENT_BACKFILL_TIMEOUT_MS
    );
    setBackfillState("loading");
    setShowBackfillMenu(false);
    setBackfillMessage(`${rangeLabel} · checking the connected account…`);
    try {
      const existingIds = new Set(messages.map((message) => message.id));
      // A zero-hour request pages backward from the oldest message already in
      // Omni. Dated windows reconcile gaps inside more recent history.
      const historyWindow = hours ? `?hours=${hours}` : "";
      const response = await fetch(`/api/conversations/${conversation.id}/backfill${historyWindow}`, {
        method: "POST",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as {
        imported?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Message backfill could not finish.");

      await refreshMessagesAfterBackfill(controller.signal);
      // Baileys returns before WhatsApp delivers its history event. One second
      // later, refresh again so that asynchronous imports appear without a
      // manual page reload.
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const refreshedMessages = await refreshMessagesAfterBackfill(controller.signal);
      const visibleRecovered = refreshedMessages.filter(
        (message) => !existingIds.has(message.id)
      ).length;
      const recovered = Math.max(data.imported || 0, visibleRecovered);
      setBackfillState("success");
      setBackfillMessage(
        recovered
          ? `${recovered} ${recovered === 1 ? "message" : "messages"} recovered.`
          : `${rangeLabel} checked. No additional messages were available.`
      );
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason === "send-priority") {
        setBackfillState("idle");
        setBackfillMessage("");
        return;
      }
      setBackfillState("error");
      setBackfillMessage(
        controller.signal.aborted
          ? "History check timed out. The chat is still usable; try again later."
          : error instanceof Error
            ? error.message
            : "Message backfill could not finish."
      );
    } finally {
      window.clearTimeout(timeout);
      if (backfillAbortRef.current === controller) backfillAbortRef.current = null;
    }
  }

  async function recoverMessageMedia(message: MessageDTO, automatic = false): Promise<void> {
    if (!automatic && recoveringMediaId) {
      throw new Error("Another attachment is already being recovered.");
    }
    if (!automatic) setRecoveringMediaId(message.id);
    try {
      const response = await fetch(
        `/api/messages/${encodeURIComponent(message.id)}/media?${automatic ? "automatic=1" : "force=1"}`,
        { method: "POST" }
      );
      const data = (await response.json().catch(() => ({}))) as {
        mediaUrl?: string | null;
        mediaName?: string | null;
        mediaIsGif?: boolean;
        mediaType?: MessageDTO["mediaType"];
        error?: string;
      };
      if (!response.ok || !data.mediaUrl) {
        throw new Error(data.error || "The attachment could not be recovered.");
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                mediaUrl: data.mediaUrl || item.mediaUrl,
                mediaName: data.mediaName ?? item.mediaName,
                mediaIsGif: data.mediaIsGif ?? item.mediaIsGif,
                mediaType: data.mediaType ?? item.mediaType,
              }
            : item
        )
      );
    } finally {
      if (!automatic) setRecoveringMediaId(null);
    }
  }

  function BackfillButton({ compact = false }: { compact?: boolean }) {
    if (!canSyncConversation) return null;
    const loadingHistory = backfillState === "loading";
    return (
      <div ref={backfillMenuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setShowBackfillMenu((current) => !current)}
          disabled={loadingHistory}
          title="Check message coverage and recover chat history"
          aria-label={loadingHistory ? "Recovering history" : "Chat history"}
          aria-haspopup="menu"
          aria-expanded={showBackfillMenu}
          className={`history-button flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white font-semibold text-slate-600 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 ${
            compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-xs"
          }`}
        >
          <DownloadIcon className={`h-3.5 w-3.5 ${loadingHistory ? "animate-pulse" : syncDelayed || historyIssue || conversation.previewOnly ? "text-amber-500" : ""}`} />
          <span className="history-button-label">{loadingHistory ? "Recovering…" : historyLabel}</span>
          {!loadingHistory && (
            <span
              aria-hidden="true"
              className={`ml-0.5 h-1.5 w-1.5 rotate-45 border-b border-r border-current transition-transform ${
                showBackfillMenu ? "-rotate-[135deg] translate-y-0.5" : ""
              }`}
            />
          )}
        </button>
        <AnimatePresence>
          {showBackfillMenu && !loadingHistory && (
            <motion.div
              role="menu"
              aria-label="Chat history range"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 top-full z-50 mt-2 max-h-[70dvh] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 text-left shadow-xl shadow-slate-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40"
            >
              <div className="mb-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-[#272727] dark:text-neutral-300">
                <p className="font-semibold">{historyLabel === "History" ? syncHealthView(syncStatus).label : historyLabel}</p>
                <p className="mt-1">{syncDelayed ? syncHealthView(syncStatus).detail : historyIssue?.state === "blocked" ? "Recovery could not finish. Saved messages are safe, but this thread may be incomplete." : historyIssue ? "A background history check is queued for this chat. This is not proof that messages are missing." : conversation.previewOnly ? "The latest item is an X inbox preview. Full messages and sender details are still being checked." : syncHealthView(syncStatus).detail}</p>
                {historyIssue?.retryAt ? <p className="mt-1">Automatic retry after {new Date(historyIssue.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p> : null}
                {syncStatus?.sync?.lastCheckedAt ? <p className="mt-1">Platform inbox checked at {new Date(syncStatus.sync.lastCheckedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Older history may still be incomplete.</p> : null}
                {nativeChatUrl && <a role="menuitem" href={nativeChatUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex rounded font-semibold text-accent underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">Open {PLATFORMS[conversation.platform].label}{conversation.platform === "x" ? " chat" : " inbox"} ↗</a>}
              </div>
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                Recover chat history
              </div>
              {BACKFILL_OPTIONS.map((option) => (
                <button
                  key={option.hours}
                  type="button"
                  role="menuitem"
                  onClick={() => void backfillMessages(option.hours)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-100 focus:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-300">
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-neutral-100">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-neutral-400">
                      {option.detail}
                    </span>
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  async function updateTranslationSettings(input: {
    enabled: boolean;
    languageCode?: string | null;
    languageName?: string | null;
  }) {
    if (savingTranslation) return;
    const previousConfig = translationConfig;
    setSavingTranslation(true);
    setTranslationSettingsError(null);
    setTranslationConfig((current) => ({
      ...current,
      enabled: input.enabled,
      languageCode:
        input.languageCode === undefined ? current.languageCode : input.languageCode,
      languageName:
        input.languageName === undefined ? current.languageName : input.languageName,
    }));
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/translation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json().catch(() => ({}))) as {
        translationEnabled?: boolean;
        translationLanguageCode?: string | null;
        translationLanguageName?: string | null;
        available?: boolean;
        detail?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Translation settings could not be saved.");
      setTranslationConfig({
        enabled: Boolean(data.translationEnabled),
        languageCode: data.translationLanguageCode || null,
        languageName: data.translationLanguageName || null,
        available: data.available ?? true,
        detail: data.detail || "Runs privately on this Mac",
      });
    } catch (error) {
      setTranslationConfig(previousConfig);
      setTranslationSettingsError(
        error instanceof Error ? error.message : "Translation settings could not be saved."
      );
    } finally {
      setSavingTranslation(false);
    }
  }

  async function translateIncomingMessage(message: MessageDTO) {
    if (message.translatedBody) {
      setShownTranslations((current) => {
        const next = new Set(current);
        if (next.has(message.id)) next.delete(message.id);
        else next.add(message.id);
        return next;
      });
      return;
    }
    if (translatingMessageId) return;
    setTranslatingMessageId(message.id);
    setTranslationMessageError(null);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/translation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        translatedBody?: string | null;
        translationSourceLanguage?: string | null;
        translationTargetLanguage?: string | null;
        error?: string;
      };
      if (!response.ok || !data.translatedBody) {
        throw new Error(data.error || "The message could not be translated.");
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                translatedBody: data.translatedBody,
                translationSourceLanguage: data.translationSourceLanguage,
                translationTargetLanguage: data.translationTargetLanguage,
              }
            : item
        )
      );
      setShownTranslations((current) => {
        const next = new Set(current);
        if (translationConfig.enabled) next.delete(message.id);
        else next.add(message.id);
        return next;
      });
    } catch (error) {
      setTranslationMessageError({
        messageId: message.id,
        message: error instanceof Error ? error.message : "The message could not be translated.",
      });
    } finally {
      setTranslatingMessageId(null);
    }
  }

  function scheduleDeliveryRefresh(
    messageId: string,
    preview: string,
    attempt = 0
  ): void {
    const delay = DELIVERY_REFRESH_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = window.setTimeout(async () => {
      deliveryRefreshTimersRef.current.delete(timer);
      if (activeDeliveryConversationRef.current !== conversation.id) return;
      try {
        const response = await fetch(
          `/api/conversations/${conversation.id}/messages?limit=1&deliveryIds=${encodeURIComponent(messageId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error("Delivery refresh failed");
        const data = (await response.json()) as { deliveries?: MessageDTO[] };
        if (activeDeliveryConversationRef.current !== conversation.id) return;
        const refreshed = data.deliveries?.find((message) => message.id === messageId);
        if (refreshed) {
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId ? mergeDeliveryReceipt(message, refreshed) : message
            )
          );
          if (refreshed.deliveryStatus === "sent") {
            setAttachError(null);
            if (!notifiedSentRef.current.has(refreshed.id)) {
              notifiedSentRef.current.add(refreshed.id);
              onSentRef.current(preview);
            }
            return;
          }
          if (
            refreshed.deliveryStatus === "failed" ||
            refreshed.deliveryStatus === "unconfirmed"
          )
            return;
        }
      } catch {
        // The normal thread poll remains the fallback if a fast refresh fails.
      }
      scheduleDeliveryRefresh(messageId, preview, attempt + 1);
    }, delay);
    deliveryRefreshTimersRef.current.add(timer);
  }

  async function send() {
    const body = draft.trim();
    if (!body && !attachment) return;
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    autocorrectAbortRef.current?.abort();
    autocorrectAbortRef.current = null;
    setAutoCorrecting(false);
    setAutoCorrectionNotice(null);
    setComposerNotice(null);
    backfillAbortRef.current?.abort("send-priority");
    backfillAbortRef.current = null;
    const file = attachment;
    const replyTarget = replyingTo;
    const mentions = selectedMentions;
    const previewUrl = attachmentUrl;

    const tempId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const temp: MessageDTO = {
      id: tempId,
      body,
      originalBody: translationConfig.enabled && body ? body : null,
      translationSourceLanguage: translationConfig.enabled && body ? "English" : null,
      translationTargetLanguage:
        translationConfig.enabled && body ? translationConfig.languageName : null,
      direction: "out",
      mediaType: file ? mimeToMediaType(file.type) : null,
      mediaUrl: file ? previewUrl : null,
      mediaName: file?.name || null,
      mediaIsGif: file?.type === "image/gif",
      pinnedAt: null,
      createdAt: new Date().toISOString(),
      replyToExternalKey: replyTarget?.replyToExternalKey || null,
      replyPreview: replyTarget
        ? replyTarget.body || (replyTarget.mediaType ? MEDIA_LABEL[replyTarget.mediaType] : "Message")
        : null,
      replySender: replyTarget
        ? replyTarget.direction === "out" ? "You" : replyTarget.senderName || conversation.contact.name
        : null,
      senderName: null,
      senderAvatarUrl: null,
      senderTags: [],
      mentionNames: Object.fromEntries(
        groupMembers.flatMap((member) => {
          const external = member.externalKey?.replace(/^whatsapp:/, "") || "";
          const id = external.match(/^(\d+)@(?:c\.us|s\.whatsapp\.net|lid)$/)?.[1];
          return id && mentions.includes(external) ? [[id, member.name] as const] : [];
        })
      ),
      mentionTargets: Object.fromEntries(
        mentions.flatMap((external) => {
          const id = external.match(/^(\d+)@(?:c\.us|s\.whatsapp\.net|lid)$/)?.[1];
          return id ? [[id, external] as const] : [];
        })
      ),
      deliveryStatus: "sending",
      deliveryError: null,
    };
    const preview = body || (temp.mediaType ? MEDIA_LABEL[temp.mediaType] : "Message");
    setMessages((m) => [...m, temp]);
    setDraft("");
    saveConversationDraft(conversation.id, "");
    setReplyingTo(null);
    setSelectedMentions([]);
    setAttachment(null);
    setAttachmentUrl(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
    );

    const controller = new AbortController();
    const requestTimer = window.setTimeout(
      () => controller.abort("timeout"),
      translationConfig.enabled
        ? CLIENT_TRANSLATED_SEND_TIMEOUT_MS
        : CLIENT_SEND_TIMEOUT_MS
    );

    let res: Response;
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("body", body);
        if (mentions.length) form.append("mentions", JSON.stringify(mentions));
        form.append("clientMessageId", tempId);
        if (replyTarget) form.append("replyToMessageId", replyTarget.id);
        res = await fetch(`/api/conversations/${conversation.id}/messages`, {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } else {
        res = await fetch(`/api/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            mentions,
            replyToMessageId: replyTarget?.id,
            clientMessageId: tempId,
          }),
          signal: controller.signal,
        });
      }
    } catch {
      const deliveryError =
        "The request ended before delivery was confirmed. Check the native app before retrying.";
      setMessages((current) =>
        current.map((message) =>
          message.id === tempId && message.deliveryStatus !== "sent"
            ? { ...message, deliveryStatus: "unconfirmed", deliveryError }
            : message
        )
      );
      if (!deliveryMessagesRef.current.some(message => message.id === tempId && message.deliveryStatus === "sent"))
        setAttachError(deliveryError);
      scheduleDeliveryRefresh(tempId, preview);
      return;
    } finally {
      window.clearTimeout(requestTimer);
      sendInFlightRef.current = false;
    }

    if (res.status === 202) {
      const pending = await res.json().catch(() => ({})) as {
        message?: MessageDTO;
        error?: string;
      };
      if (pending.message) {
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId ? mergeDelivery(message, pending.message!) : message
          )
        );
      }
      if (pending.message?.deliveryStatus === "sent") {
        setAttachError(null);
        if (!notifiedSentRef.current.has(pending.message.id)) {
          notifiedSentRef.current.add(pending.message.id);
          onSentRef.current(preview);
        }
      } else if (
        pending.message?.deliveryStatus === "failed" ||
        pending.message?.deliveryStatus === "unconfirmed"
      ) {
        setAttachError(pending.error || pending.message.deliveryError || null);
      } else {
        scheduleDeliveryRefresh(pending.message?.id || tempId, preview);
      }
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as {
        error?: string;
        message?: MessageDTO;
      };
      if (err.message) {
        setMessages((current) =>
          current.map((message) => (message.id === tempId ? mergeDelivery(message, err.message!) : message))
        );
      }
      setAttachError(err.error || "Couldn't send message.");
      setReplyingTo(replyTarget);
      if (!err.message) {
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId && message.deliveryStatus !== "sent"
              ? {
                  ...message,
                  deliveryStatus: "failed",
                  deliveryError: err.error || "The message was not sent.",
                }
              : message
          )
        );
      }
      return;
    }

    let msg: MessageDTO;
    try {
      msg = await res.json();
    } catch {
      setMessages((current) =>
        current.map((message) =>
          message.id === tempId && message.deliveryStatus !== "sent"
            ? { ...message, deliveryStatus: "unconfirmed" }
            : message
        )
      );
      scheduleDeliveryRefresh(tempId, preview);
      return;
    }
    setMessages((m) => m.map((item) => (item.id === tempId ? mergeDelivery(item, msg) : item)));
    notifiedSentRef.current.add(msg.id);
    onSentRef.current(preview);
  }

  async function reactToMessage(message: MessageDTO, emoji: string) {
    if (!canReactConversation || reactingMessageId) return;
    const remove =
      message.reactions?.some(
        (reaction) => reaction.emoji === emoji && reaction.who.includes("You")
      ) ?? false;
    setReactionPickerMessageId(null);
    setReactingMessageId(message.id);
    setReactionError(null);
    try {
      const response = await fetch(
        `/api/conversations/${conversation.id}/messages/${message.id}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji, remove }),
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        reactions?: MessageDTO["reactions"];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "The reaction could not be sent.");
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...item, reactions: data.reactions || [] }
            : item
        )
      );
    } catch (error) {
      setReactionError({
        messageId: message.id,
        message:
          error instanceof Error
            ? error.message
            : "The reaction could not be sent.",
      });
    } finally {
      setReactingMessageId(null);
    }
  }

  async function toggleMessagePin(message: MessageDTO) {
    if (readOnly || message.deliveryStatus === "sending" || pinningMessageId) return;
    const previousPinnedAt = message.pinnedAt ?? null;
    const nextPinnedAt = previousPinnedAt ? null : new Date().toISOString();
    setPinError(null);
    setPinningMessageId(message.id);
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, pinnedAt: nextPinnedAt } : item
      )
    );

    try {
      const response = await fetch(
        `/api/conversations/${conversation.id}/messages/${message.id}/pin`,
        { method: previousPinnedAt ? "DELETE" : "PUT" }
      );
      const data = (await response.json().catch(() => ({}))) as {
        pinnedAt?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "The message could not be pinned.");
      const savedPinnedAt = data.pinnedAt ?? null;
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, pinnedAt: savedPinnedAt } : item
        )
      );
      window.dispatchEvent(
        new CustomEvent(MESSAGE_PIN_CHANGED_EVENT, {
          detail: {
            conversationId: conversation.id,
            messageId: message.id,
            pinnedAt: savedPinnedAt,
          },
        })
      );
    } catch (error) {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, pinnedAt: previousPinnedAt } : item
        )
      );
      setPinError({
        messageId: message.id,
        message: error instanceof Error ? error.message : "The message could not be pinned.",
      });
    } finally {
      setPinningMessageId(null);
    }
  }

  function PinAction({ message }: { message: MessageDTO }) {
    if (readOnly || message.deliveryStatus === "sending") return null;
    const pinned = Boolean(message.pinnedAt);
    return (
      <button
        type="button"
        onClick={() => toggleMessagePin(message)}
        disabled={pinningMessageId === message.id}
        title={pinned ? "Unpin from chat details" : "Pin to chat details"}
        aria-label={pinned ? "Unpin message" : "Pin message"}
        aria-pressed={pinned}
        className={`grid h-8 w-8 place-items-center rounded-lg transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
          pinned
            ? "bg-accent/15 text-accent"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-500 dark:hover:bg-[#272727] dark:hover:text-neutral-200"
        }`}
      >
        <PinIcon className="h-4 w-4" />
      </button>
    );
  }

  function ReactionAction({
    message,
    align,
  }: {
    message: MessageDTO;
    align: "left" | "right";
  }) {
    if (!canReactConversation || message.id.startsWith("client_")) return null;
    const open = reactionPickerMessageId === message.id;
    return (
      <div className="relative" data-reaction-picker>
        <button
          type="button"
          onClick={() =>
            setReactionPickerMessageId((current) =>
              current === message.id ? null : message.id
            )
          }
          disabled={reactingMessageId === message.id}
          title="Add reaction"
          aria-label="Add reaction"
          aria-expanded={open}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:text-neutral-500 dark:hover:bg-[#272727] dark:hover:text-neutral-200"
        >
          <SmileyIcon className="h-4 w-4" />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className={`absolute bottom-full z-20 mb-2 flex gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-[#272727] ${
                align === "left" ? "left-0" : "right-0"
              }`}
              role="menu"
              aria-label="Choose a reaction"
            >
              {QUICK_REACTIONS.map((emoji) => {
                const selected = message.reactions?.some(
                  (reaction) =>
                    reaction.emoji === emoji && reaction.who.includes("You")
                );
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => reactToMessage(message, emoji)}
                    className={`grid h-9 w-9 place-items-center rounded-lg text-base transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-[#313131] ${
                      selected ? "bg-accent/15 ring-1 ring-accent/40" : ""
                    }`}
                    role="menuitem"
                    aria-label={`${selected ? "Remove" : "React with"} ${emoji}`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const platform = PLATFORMS[conversation.platform];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="thread-surface relative flex h-full min-w-0 flex-col"
    >
      <AnimatePresence>
        {dragActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-white/90 p-6 shadow-2xl backdrop-blur-md dark:bg-neutral-950/90"
            role="status"
            aria-live="polite"
          >
            <div className="flex max-w-sm flex-col items-center text-center">
              <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
                <PaperclipIcon className="h-6 w-6" />
              </span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">
                Drop to attach
              </span>
              <span className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                {caps.hint} · up to 25 MB
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {memberProfile && (
          <motion.aside
            data-member-profile
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-3 bottom-24 z-50 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20 sm:w-96 dark:border-neutral-700 dark:bg-[#1F1F1F]"
            aria-label={`${memberProfile.name} profile`}
          >
            <header className="flex items-start gap-3 border-b border-slate-100 p-4 dark:border-neutral-800">
              <Avatar
                name={memberProfile.name}
                platform={conversation.platform}
                size="md"
                src={memberProfile.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold text-slate-900 dark:text-neutral-100">
                  {memberProfile.name}
                </h2>
                {memberProfile.handle &&
                  memberProfile.handle !== memberProfile.name && (
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">
                      {memberProfile.handle}
                    </p>
                  )}
                <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                  {PLATFORMS[conversation.platform].label}
                  {conversation.account?.label
                    ? ` via ${conversation.account.label}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMemberProfile(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                aria-label="Close profile"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-3 p-4">
              {(memberProfile.company ||
                memberProfile.email ||
                memberProfile.phone) && (
                <dl className="space-y-2 text-xs">
                  {memberProfile.company && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-slate-400 dark:text-neutral-500">Company</dt>
                      <dd className="text-right font-medium text-slate-700 dark:text-neutral-200">
                        {memberProfile.company}
                      </dd>
                    </div>
                  )}
                  {memberProfile.email && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-slate-400 dark:text-neutral-500">Email</dt>
                      <dd className="min-w-0 truncate text-right font-medium text-slate-700 dark:text-neutral-200">
                        {memberProfile.email}
                      </dd>
                    </div>
                  )}
                  {memberProfile.phone && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-slate-400 dark:text-neutral-500">Phone</dt>
                      <dd className="text-right font-medium text-slate-700 dark:text-neutral-200">
                        {memberProfile.phone}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {memberProfile.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {memberProfile.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded px-2 py-1 text-xs font-medium text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}

              {!memberProfile.company &&
                !memberProfile.email &&
                !memberProfile.phone &&
                memberProfile.tags.length === 0 && (
                  <p className="text-xs leading-5 text-slate-400 dark:text-neutral-500">
                    No additional CRM details are saved for this person yet.
                  </p>
                )}

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 dark:border-neutral-700">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700 dark:text-neutral-200">
                      Private conversation
                    </h3>
                    {memberConversation?.accountLabel && (
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-neutral-500">
                        {memberConversation.accountLabel}
                      </p>
                    )}
                  </div>
                  {memberConversation && (
                    <span className="text-[11px] text-slate-400 dark:text-neutral-500">
                      {clockTime(memberConversation.lastMessageAt)}
                    </span>
                  )}
                </div>

                <div className="max-h-48 space-y-2 overflow-y-auto px-3 py-3">
                  {memberConversationLoading ? (
                    <div className="space-y-2" aria-label="Loading private conversation">
                      <div className="h-9 w-3/4 animate-pulse rounded-lg bg-slate-200 dark:bg-neutral-800" />
                      <div className="ml-auto h-10 w-2/3 animate-pulse rounded-lg bg-accent/15" />
                      <div className="h-8 w-1/2 animate-pulse rounded-lg bg-slate-200 dark:bg-neutral-800" />
                    </div>
                  ) : memberConversation?.messages.length ? (
                    memberConversation.messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.direction === "out" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-lg px-2.5 py-2 text-xs leading-4 ${
                            message.direction === "out"
                              ? "bg-accent/15 text-slate-800 dark:text-neutral-100"
                              : "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700"
                          }`}
                        >
                          <p className="line-clamp-2 whitespace-pre-wrap break-words">
                            {directMessagePreview(message)}
                          </p>
                          <p className="mt-1 text-right text-[10px] text-slate-400 dark:text-neutral-500">
                            {clockTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center">
                      <p className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                        No private messages saved yet
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-400 dark:text-neutral-500">
                        Open the private chat to message them. Group messages stay in the group.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {memberConversationError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">
                  {memberConversationError}
                </p>
              )}

              {!readOnly &&
              onOpenConversation &&
              (memberConversation ||
                (memberProfile.externalKey &&
                  (conversation.platform === "telegram" ||
                    conversation.platform === "whatsapp"))) ? (
                <button
                  type="button"
                  disabled={memberConversationLoading || openingMemberConversation}
                  onClick={() => void openOrStartMemberConversation(memberProfile)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:brightness-95 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:text-accent-fg dark:focus-visible:ring-offset-[#1F1F1F]"
                >
                  <SendIcon className="h-4 w-4" />
                  {memberConversationLoading
                    ? "Checking conversation…"
                    : openingMemberConversation
                      ? "Opening…"
                      : memberConversation
                        ? "Open full conversation"
                        : "Start private conversation"}
                </button>
              ) : (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                  Private messaging is unavailable for this member.
                </p>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {/* Header — identical layout for every platform, only the badge differs */}
      <div className="thread-header">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
            aria-label="Back to conversations"
            title="Back to conversations"
          >
            <ReplyIcon className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onOpenContact}
          title="Open profile"
          aria-label={`Open ${conversation.contact.name}'s profile`}
          className={`shrink-0 ${conversation.isGroup ? "rounded-xl" : "rounded-full"} transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-2 hover:ring-accent/40 hover:ring-offset-2 hover:ring-offset-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:ring-offset-neutral-900`}
        >
          <Avatar
            name={conversation.contact.name}
            platform={conversation.platform}
            size="sm"
            src={conversation.contact.avatarUrl}
            group={conversation.groupPreview}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <ChatTypeIcon
              isGroup={conversation.isGroup}
              handle={conversation.contact.handle}
            />
            <span className="truncate text-base font-semibold text-slate-900 dark:text-neutral-100">
              {conversation.contact.name}
            </span>
            <span className="hidden sm:contents">

            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-neutral-500">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: platform.bg }}
            />
            <span className="shrink-0">{platform.label} ·</span>
            {conversation.isGroup && conversation.groupPreview?.count ? (
              <button type="button" onClick={onOpenContact}
                aria-label={`View ${conversation.groupPreview.count} people seen in this group`}
                title="People from synced messages. Open to see their profiles."
                className="min-w-0 truncate rounded text-left transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {groupPeopleLabel(conversation.groupPreview)}
              </button>
            ) : <span className="truncate">{conversation.contact.handle}</span>}
            {conversation.account?.label && (
              <span
                title="The account you're messaging from"
                className="ml-1 hidden max-w-32 truncate text-xs text-slate-400 xl:inline dark:text-neutral-500"
              >
                via {conversation.account.label}
              </span>
            )}
          </div>
        </div>
        <ChatSearch key={conversation.id} conversationId={conversation.id} name={conversation.contact.name} onSelect={jumpToSearchMessage} />
        {!readOnly &&
          onMarkDone &&
          conversation.status !== "done" && (
          <button
            type="button"
            onClick={onMarkDone}
            title="Mark done and open the next conversation"
            aria-label="Mark done and open the next conversation"
            className="thread-done flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-500 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
          >
            <CheckCircleIcon className="h-4 w-4" />
            <span
              className={
                multiViewCompact ? "hidden 2xl:inline" : "inline"
              }
            >
              Done
            </span>
          </button>
        )}
        {!readOnly && canSyncConversation && !compactMessageLimit && messages.length > 0 && (
          <span className={multiViewCompact ? "hidden 2xl:inline" : "inline"}>
            <BackfillButton />
          </span>
        )}
        <button type="button" onClick={onOpenContact} title="Contact details" aria-label="Contact details" className="thread-details hidden h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-slate-500 transition-colors duration-200 hover:bg-slate-100 lg:flex dark:text-neutral-400 dark:hover:bg-neutral-800"><SidebarIcon className="h-4 w-4" /><span>Details</span></button>
        <MenuDetails className="thread-options relative shrink-0">
                      <summary aria-label="Conversation options" className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg text-slate-500 transition-colors duration-200 hover:bg-slate-100 dark:hover:bg-neutral-800 [&::-webkit-details-marker]:hidden"><MoreIcon className="h-4 w-4" /></summary>
          <div className="thread-options-menu workspace-menu absolute right-0 top-full z-40 mt-2 flex w-64 flex-col gap-1 p-2">
            <button type="button" data-close-menu onClick={e => { onOpenContact(); }} className="workspace-menu-item text-left">Contact details</button>
        {multiViewAction && multiViewAction.kind !== "close" && (
          <button
            type="button"
            onClick={multiViewAction.onClick}
            title={multiViewAction.label}
            aria-label={multiViewAction.label}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              multiViewAction.kind === "unpin"
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            }`}
          >
            <PinIcon className="h-4 w-4" />
            <span className={multiViewCompact ? "hidden 2xl:inline" : "hidden xl:inline"}>
              {multiViewAction.label}
            </span>
          </button>
        )}
        {!readOnly &&
          conversation.platform === "telegram" &&
          conversation.isGroup && (
            <KeywordAlertControl
              conversation={conversation}
              compact={multiViewCompact}
            />
          )}
        {!readOnly && (
          <div className="relative" data-translation-menu>
            <button
              type="button"
              onClick={() => setShowTranslationMenu((current) => !current)}
              title={
                translationConfig.enabled
                  ? `Reading in English and sending in ${translationConfig.languageName || "the receiver's language"}`
                  : "Private local translation"
              }
              aria-label="Local translation settings"
              aria-expanded={showTranslationMenu}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                translationConfig.enabled
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              <GlobeIcon className="h-4 w-4" />
              <span
                className={`max-w-24 truncate ${
                  multiViewCompact ? "hidden 2xl:inline" : "hidden lg:inline"
                }`}
              >
                {translationConfig.enabled
                  ? translationConfig.languageName || "Translate on"
                  : "Translate"}
              </span>
              {translationConfig.available === false && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Setup needed" />
              )}
            </button>
            <AnimatePresence>
              {showTranslationMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
                  className="relative mt-2 w-full rounded-lg bg-slate-50 p-3 text-left dark:bg-[#272727]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                        Translate this chat
                      </div>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                        Read every received message in English and write replies in English.
                      </p>
                    </div>
                    <div className="mt-0.5 flex shrink-0 items-center gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          translationConfig.enabled
                            ? "text-accent"
                            : "text-slate-400 dark:text-neutral-500"
                        }`}
                        aria-hidden="true"
                      >
                        {translationConfig.enabled ? "On" : "Off"}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={translationConfig.enabled}
                        aria-label={`Automatic chat translation ${translationConfig.enabled ? "on" : "off"}`}
                        title={translationConfig.enabled ? "Turn translation off" : "Turn translation on"}
                        disabled={savingTranslation || translationConfig.available === false}
                        onClick={() =>
                          updateTranslationSettings({ enabled: !translationConfig.enabled })
                        }
                        className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                          translationConfig.enabled
                            ? "bg-accent"
                            : "bg-slate-300 dark:bg-neutral-600"
                        }`}
                      >
                        <span
                          className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                            translationConfig.enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                    Receiver language
                  </label>
                  <select
                    value={translationConfig.languageCode || "auto"}
                    disabled={savingTranslation || translationConfig.available === false}
                    onChange={(event) => {
                      if (event.target.value === "auto") {
                        updateTranslationSettings({
                          enabled: true,
                          languageCode: null,
                          languageName: null,
                        });
                        return;
                      }
                      const language = TRANSLATION_LANGUAGES.find(
                        (item) => item.code === event.target.value
                      );
                      if (language) {
                        updateTranslationSettings({
                          enabled: true,
                          languageCode: language.code,
                          languageName: language.name,
                        });
                      }
                    }}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    <option value="auto">Detect from recent messages</option>
                    {translationConfig.languageCode &&
                      !TRANSLATION_LANGUAGES.some(
                        (language) => language.code === translationConfig.languageCode
                      ) && (
                        <option value={translationConfig.languageCode}>
                          {translationConfig.languageName || translationConfig.languageCode}
                        </option>
                      )}
                    {TRANSLATION_LANGUAGES.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                  {savingTranslation && (
                    <div className="mt-2 text-xs font-medium text-accent" role="status">
                      Detecting and saving…
                    </div>
                  )}
                  {translationConfig.available === false && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      {translationConfig.detail || "Open Ollama to enable private local translation."}
                    </div>
                  )}
                  {translationSettingsError && (
                    <div className="mt-2 text-xs leading-5 text-red-600 dark:text-red-300" role="alert">
                      {translationSettingsError}
                    </div>
                  )}
                  {translationConfig.enabled && translationConfig.languageName && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-neutral-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Reads in English · sends in {translationConfig.languageName} · stays on this Mac.
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {!readOnly &&
          onArchiveAndMute &&
          (conversation.platform === "telegram" ||
            conversation.platform === "whatsapp") && (
          <button
            type="button"
            onClick={onArchiveAndMute}
            disabled={archiveAndMutePending}
            title={
              conversation.archived
                ? `Restore and unmute on ${platform.label}`
                : `Archive and mute on ${platform.label}`
            }
            aria-label={
              conversation.archived
                ? `Restore and unmute on ${platform.label}`
                : `Archive and mute on ${platform.label}`
            }
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
          >
            <ArchiveIcon
              className={`h-4 w-4 ${archiveAndMutePending ? "animate-pulse" : ""}`}
            /><span>{conversation.archived ? "Restore and unmute" : "Archive and mute"}</span>
          </button>
        )}
          </div>
        </MenuDetails>
        {multiViewAction?.kind === "close" && (
          <ClosePaneButton onClick={multiViewAction.onClick} className="hidden lg:inline-flex" />
        )}
      </div>

      {/* Forum topic tabs */}
      {topics && topics.length > 0 && (
        <div className="scroll-thin flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelectTopic?.(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                t.id === conversation.id
                  ? "bg-accent text-accent-fg"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {t.name}
              {t.unread > 0 && (
                <span
                  className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    t.id === conversation.id
                      ? "bg-white/25"
                      : "bg-accent text-accent-fg"
                  }`}
                >
                  {t.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          const distanceFromLatest =
            el.scrollHeight - el.scrollTop - el.clientHeight;
          nearBottomRef.current = distanceFromLatest < 120;
          setShowScrollToLatest(distanceFromLatest > 240);
        }}
        className="thread-surface scroll-thin h-full overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div ref={messageContentRef}>
        {loading ? (
          <div
            className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-8"
            aria-label="Opening conversation"
            role="status"
          >
            <div className="h-16 w-2/5 animate-pulse self-start rounded-2xl bg-slate-200 dark:bg-[#1F1F1F]" />
            <div className="h-24 w-3/5 animate-pulse self-end rounded-2xl bg-slate-200 dark:bg-[#272727]" />
            <div className="h-12 w-1/3 animate-pulse self-start rounded-2xl bg-slate-200 dark:bg-[#1F1F1F]" />
          </div>
        ) : (
          <>
          {compactMessageLimit && messages.length > 0 && (
            <div className="sticky top-0 z-10 mx-auto mb-4 flex w-max items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-500 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-400">
              {messages.length > compactMessageLimit && (
                <>
                  <span>
                    {showFullContext
                      ? "Full conversation view"
                      : `Showing the latest ${Math.min(compactMessageLimit, messages.length)} messages`}
                  </span>
                  <button
                    onClick={() => {
                      setShowFullContext((current) => !current);
                      requestAnimationFrame(() =>
                        scrollRef.current?.scrollTo({
                          top: showFullContext ? scrollRef.current.scrollHeight : 0,
                          behavior: "smooth",
                        })
                      );
                    }}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    {showFullContext
                      ? "Show recent only"
                      : `Show full conversation${compactHiddenCount ? ` · ${compactHiddenCount} more` : ""}`}
                  </button>
                </>
              )}
              <BackfillButton compact />
            </div>
          )}
          {backfillState !== "idle" && (
            <div
              role="status"
              className={`mx-auto mb-4 max-w-xl rounded-xl border px-4 py-3 text-center text-xs font-medium ${
                backfillState === "error"
                  ? "border-red-500/40 bg-red-50 text-red-700 dark:bg-neutral-900 dark:text-red-300"
                  : backfillState === "success"
                    ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-neutral-900 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              {backfillMessage}
            </div>
          )}
          {messages.length === 0 && (
            <div className="mx-auto flex min-h-64 max-w-md flex-col items-center justify-center text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-slate-200 text-slate-500 dark:bg-neutral-800 dark:text-neutral-300">
                <DownloadIcon className="h-5 w-5" />
              </div>
              <div className="mt-4 text-sm font-semibold text-slate-800 dark:text-neutral-100">
                {conversation.platform === "whatsapp" && !conversation.isGroup
                  ? `Private chat with ${conversation.contact.name}`
                  : "No messages are synced yet"}
              </div>
              <p className="mt-2 text-pretty text-xs leading-5 text-slate-500 dark:text-neutral-400">
                {conversation.platform === "whatsapp" && !conversation.isGroup
                  ? "You can message them here. No private messages are saved in Omni yet. Group messages stay in the group; older DMs appear when WhatsApp shares them with this device."
                  : "Ask the connected account for this conversation’s recent history."}
              </p>
              {conversation.platform !== "whatsapp" && <div className="mt-4">
                <BackfillButton />
              </div>}
            </div>
          )}
          {hasMore && (!compactMessageLimit || showFullContext) && (
            <div className="flex justify-center pb-2">
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="rounded-full bg-slate-200/80 px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {loadingOlder ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}
          {visibleMessages.map((m, idx) => {
            const showDate =
              idx === 0 || !sameDay(visibleMessages[idx - 1].createdAt, m.createdAt);
            // Keep a speaker's photo and name together at the start of a run.
            // Use identity, never display-name equality, to group their messages.
            const inbound = m.direction !== "out";
            const groupIncoming = inbound && conversation.isGroup;
            const deliveryStatus = inbound ? undefined : m.deliveryStatus || "sent";
            const key = messageSenderKey(m, conversation.isGroup);
            const prev = visibleMessages[idx - 1];
            const next = visibleMessages[idx + 1];
            const prevKey = prev ? messageSenderKey(prev, conversation.isGroup) : null;
            const nextKey = next ? messageSenderKey(next, conversation.isGroup) : null;
            const firstOfRun =
              !prev ||
              prevKey !== key ||
              !sameDay(prev.createdAt, m.createdAt) ||
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() >
                MESSAGE_RUN_GAP_MS;
            const lastOfRun =
              !next ||
              nextKey !== key ||
              !sameDay(m.createdAt, next.createdAt) ||
              new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() >
                MESSAGE_RUN_GAP_MS;
            const sender = groupMessageSender(m);
            const avName = sender.name;
            const avSrc = sender.avatarUrl;
            const repliedMessage = m.replyToExternalKey ? messagesByExternalKey.get(m.replyToExternalKey) : undefined;
            const replyNameColor = conversation.isGroup && repliedMessage?.direction === "in"
              ? groupMessageSender(repliedMessage).tone.name
              : "text-slate-500 dark:text-neutral-400";
            const showsAutoEnglish = Boolean(
              inbound && translationConfig.enabled && m.translatedBody
            );
            const displayMessage = showsAutoEnglish
              ? { ...m, body: m.translatedBody || m.body }
              : m;
            const translationPending =
              translatingMessageId === m.id || autoTranslatingIds.has(m.id);
            const focused = m.id === renderedFocusMessageId;
            const showTimestamp = conversation.isGroup || showDirectMessageTimestamp({
              lastOfRun, focused, deliveryStatus, externalKey: m.externalKey,
            });
            return (
              <Fragment key={m.id}>
                {showDate && (
                  <motion.div
                    initial={false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mx-auto my-6 flex w-full max-w-4xl items-center gap-4"
                  >
                    <span className="h-px flex-1 bg-slate-100 dark:bg-neutral-800" />
                    <span className="text-xs font-medium text-slate-400 dark:text-neutral-500">
                      {dayLabel(m.createdAt)}
                    </span>
                    <span className="h-px flex-1 bg-slate-100 dark:bg-neutral-800" />
                  </motion.div>
                )}
                <motion.div
                  data-message-id={m.id}
                  data-direction={inbound ? "in" : "out"}
                  data-first-of-run={firstOfRun || undefined}
                  data-last-of-run={lastOfRun || undefined}
                  data-delivery-status={deliveryStatus}
                  initial={
                    m.deliveryStatus === "sending"
                      ? { opacity: 0, y: 8, scale: 0.98 }
                      : false
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                  className={`message-row group relative mx-auto flex w-full max-w-4xl items-end ${!conversation.isGroup ? "direct-message-row gap-3" : groupIncoming ? "group-message-row gap-3" : "gap-2"} ${firstOfRun ? conversation.isGroup ? "mt-6" : "mt-4" : "mt-1"} ${inbound ? "justify-start" : "justify-end"} ${focused ? "relative z-10" : ""}`}
                >
                  {inbound && !conversation.isGroup && (firstOfRun ? (
                    <button
                      type="button"
                      onClick={onOpenContact}
                      aria-label={`View ${conversation.contact.name}'s profile`}
                      title={`View ${conversation.contact.name}'s profile`}
                      className="direct-message-avatar shrink-0 self-start rounded-full transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-2 hover:ring-accent/40 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Avatar name={conversation.contact.name} platform={conversation.platform}
                        src={conversation.contact.avatarUrl} size="sm" showBadge={false} />
                    </button>
                  ) : <span className="w-10 shrink-0" aria-hidden="true" />)}
                  {groupIncoming &&
                    (firstOfRun ? (
                      m.senderContactId ? (
                        <button
                          type="button"
                          data-member-trigger
                          onClick={() => openSenderProfile(m)}
                          title={`View ${avName}'s profile`}
                          aria-label={`View ${avName}'s profile`}
                          className="group-message-avatar shrink-0 self-start rounded-full transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-2 hover:ring-accent hover:ring-offset-2 hover:ring-offset-white active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:ring-offset-neutral-900"
                        >
                          <Avatar
                            name={avName}
                            platform={conversation.platform}
                            size="sm"
                            showBadge={false}
                            src={avSrc}
                            fallbackClassName={sender.tone.avatar}
                          />
                        </button>
                      ) : (
                        <span className="group-message-avatar shrink-0 self-start rounded-full">
                          <Avatar
                            name={avName}
                            platform={conversation.platform}
                            size="sm"
                            showBadge={false}
                            src={avSrc}
                            fallbackClassName={sender.tone.avatar}
                          />
                        </span>
                      )
                    ) : (
                      <div className="w-10 shrink-0" aria-hidden="true" />
                    ))}
                  {!inbound && (
                    <MenuDetails className="message-actions">
                      <summary aria-label={`Message actions for ${clockTime(m.createdAt)}`} title="Message actions" className="message-actions-trigger list-none [&::-webkit-details-marker]:hidden"><MoreIcon className="h-4 w-4" /></summary>
                      <div className="workspace-menu absolute bottom-full left-0 z-30 mb-1 flex items-center p-1">

                    <ReactionAction message={m} align="right" />
                    {((["telegram", "whatsapp"] as string[]).includes(conversation.platform) || discordBotChat) && <button data-close-menu onClick={() => { setReplyingTo(m); textareaRef.current?.focus(); }} title="Reply" className="rounded-full p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-700"><ReplyIcon className="h-4 w-4" /></button>}
                    <PinAction message={m} />
                    <button data-close-menu onClick={() => setForwardMsg(m)} title="Forward" className="rounded-full p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-700">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <polyline points="15 17 20 12 15 7" />
                        <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                      </svg>
                    </button>

                      </div>
                    </MenuDetails>
                  )}
                  <div className="message-block min-w-0 max-w-xl">
                    {firstOfRun && inbound && conversation.isGroup && (
                      <div className="message-sender mb-1 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
                        {inbound && conversation.isGroup && m.senderContactId ? (
                          <button
                            type="button"
                            data-member-trigger
                            onClick={() => openSenderProfile(m)}
                            className={`min-w-0 rounded text-left text-sm font-semibold [overflow-wrap:anywhere] ${sender.tone.name} transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:underline hover:underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                            title={`View ${avName}'s profile`}
                          >
                            {avName}
                          </button>
                        ) : (
                          <span className={`text-sm font-semibold [overflow-wrap:anywhere] ${sender.tone.name}`}>
                            {avName}
                          </span>
                        )}
                        {inbound && m.senderTags.length > 0 && <MenuDetails className="relative ml-1">
                          <summary className="cursor-pointer list-none rounded px-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 [&::-webkit-details-marker]:hidden" aria-label={`View ${m.senderTags.length} contact labels`}>{m.senderTags.length} labels</summary>
                          <div className="workspace-menu absolute left-0 top-full z-20 mt-1 w-64 space-y-2 p-3">{m.senderTags.map(t => <div key={t.id} className="flex items-start gap-2 text-xs text-slate-600 dark:text-neutral-300"><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />{t.name}</div>)}</div>
                        </MenuDetails>}
                      </div>
                    )}
                  <div
                    title={!conversation.isGroup ? `${inbound ? conversation.contact.name : "You"} · ${new Date(m.createdAt).toLocaleString()}` : undefined}
                    className={`message-bubble min-w-0 w-fit max-w-xl ${groupIncoming ? "rounded-xl border border-slate-200 dark:border-neutral-700" : "rounded-md"} text-sm leading-6 transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${m.mediaType === "image" ? "p-2" : "px-3 py-2"} ${
                      m.direction === "out"
                        ? deliveryStatus === "failed"
                          ? `${lastOfRun ? "rounded-br-lg" : ""} bg-red-50 text-red-900 ring-1 ring-red-200 dark:bg-[#1F1F1F] dark:text-red-200 dark:ring-red-900`
                          : deliveryStatus === "unconfirmed"
                            ? `${lastOfRun ? "rounded-br-lg" : ""} bg-amber-50 text-amber-950 ring-1 ring-amber-200 dark:bg-[#1F1F1F] dark:text-amber-100 dark:ring-amber-900`
                            : deliveryStatus === "sending" || deliveryStatus === "pending"
                              ? `${lastOfRun ? "rounded-br-lg" : ""} bg-slate-200 text-slate-800 ring-1 ring-slate-300 dark:bg-[#272727] dark:text-neutral-100 dark:ring-neutral-700`
                              : "bg-accent/10 text-slate-900 dark:bg-[#272727] dark:text-neutral-100"
                        : "bg-slate-50 text-slate-800 dark:bg-[#1F1F1F] dark:text-neutral-100"
                    } ${
                      focused
                        ? "relative z-10 ring-2 ring-accent shadow-lg shadow-accent/20 dark:ring-accent"
                        : ""
                    }`}
                  >
                    {focused && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.3,
                          ease: [0.32, 0.72, 0, 1],
                        }}
                        className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        {replyFocus?.id === m.id
                          ? replyFocus.source === "search" ? "Search match" : "Original message"
                          : "Keyword match"}
                      </motion.div>
                    )}
                    {m.externalKey?.startsWith("x:preview:") && <p className="mb-2 text-xs text-slate-500 dark:text-neutral-400">Inbox preview · full message not yet verified</p>}
                    {m.pinnedAt && (
                      <div className={`mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${inbound ? "text-accent" : "text-current/60"}`}>
                        <PinIcon className="h-3 w-3" />
                        Pinned
                      </div>
                    )}
                    {(m.replyToExternalKey || m.replyPreview) && (
                      <button
                        type="button"
                        disabled={!m.replyToExternalKey || replyJumpingId === m.id}
                        onClick={() => void jumpToRepliedMessage(m)}
                        aria-label={`Go to message from ${m.replySender || "the original sender"}`}
                        title={
                          m.replyToExternalKey
                            ? "Go to original message"
                            : "Original message is not available"
                        }
                        className={`mb-2 block w-full rounded-lg border px-3 py-2 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${conversation.isGroup ? "border-l-2" : ""} ${
                          m.direction === "out"
                            ? "border-transparent bg-white/60 dark:bg-black/10"
                            : "border-slate-200 bg-slate-50 dark:border-neutral-600 dark:bg-[#272727]"
                        } ${
                          m.replyToExternalKey
                            ? "cursor-pointer hover:border-accent/50 hover:bg-accent/10 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            : "cursor-default"
                        } disabled:opacity-70`}
                      >
                        <div className={`flex items-center gap-1 text-xs font-semibold ${replyNameColor}`}>
                          <ReplyIcon className="h-3.5 w-3.5" />
                          {replyJumpingId === m.id
                            ? "Finding original message…"
                            : `Replying to ${m.replySender || "a message"}`}
                        </div>
                        <div className="mt-1 max-w-md truncate text-xs opacity-75">
                          {replyJumpErrorId === m.id
                            ? "Original message is not in synced history"
                            : m.replyPreview || "Original message unavailable"}
                        </div>
                      </button>
                    )}
                    <MediaContent
                      message={m}
                      onAutoRecover={canSyncConversation && canAutoLoadMedia(conversation.platform, m)
                        ? () => recoverMessageMedia(m, true) : undefined}
                      onOpenImage={setSpotlightImage}
                      onOpenVideo={(url, name, isGif) => setSpotlightVideo({ url, name, isGif })}
                      onOpenPdf={(url, name) => setPdfPreview({ url, name })}
                      onRecoverMissing={
                        canSyncConversation
                          ? () => recoverMessageMedia(m)
                          : undefined
                      }
                      recovering={recoveringMediaId === m.id}
                    />
                    {m.body && !(m.mediaType === "sticker" && m.mediaUrl) && (
                      <div
                        className={
                          m.mediaType === "image" ? "px-2 pb-1 pt-1.5" : ""
                        }
                      >
                        <MessageText
                          message={displayMessage}
                          platform={conversation.platform}
                          mentionTargets={mentionTargets}
                          onOpenMention={
                            onOpenTaggedPerson &&
                            (conversation.platform === "telegram" ||
                              conversation.platform === "whatsapp")
                              ? (target, label) =>
                                  onOpenTaggedPerson({
                                    platform: conversation.platform as Extract<
                                      Platform,
                                      "telegram" | "whatsapp"
                                    >,
                                    accountId: conversation.account?.id || null,
                                    target,
                                    label,
                                  })
                              : undefined
                          }
                        />
                      </div>
                    )}
                    {inbound && translationConfig.enabled && !m.translatedBody && translationPending && (
                      <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-neutral-500" role="status">
                        <GlobeIcon className="h-3 w-3 animate-pulse" />
                        Translating to English…
                      </div>
                    )}
                    {inbound && m.translatedBody && shownTranslations.has(m.id) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-2 border-t border-slate-200 pt-2 dark:border-neutral-700"
                      >
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                          <GlobeIcon className="h-3 w-3" />
                          {showsAutoEnglish
                            ? `Original${m.translationSourceLanguage ? ` · ${m.translationSourceLanguage}` : ""}`
                            : "English translation"}
                        </div>
                        <div className="whitespace-pre-wrap">
                          {showsAutoEnglish ? m.body : m.translatedBody}
                        </div>
                      </motion.div>
                    )}
                    {!inbound && m.originalBody && m.translationTargetLanguage && (
                      <div className="mt-2 border-t border-current/10 pt-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setShownTranslations((current) => {
                              const next = new Set(current);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            })
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold opacity-65 transition hover:opacity-100"
                        >
                          <GlobeIcon className="h-3 w-3" />
                          {m.deliveryStatus === "sending"
                            ? `Translating to ${m.translationTargetLanguage}…`
                            : `Sent in ${m.translationTargetLanguage}`}
                          {m.deliveryStatus !== "sending" &&
                            (shownTranslations.has(m.id) ? " · Hide English" : " · View English")}
                        </button>
                        {shownTranslations.has(m.id) && m.body !== m.originalBody && (
                          <div className="mt-1 whitespace-pre-wrap text-xs opacity-70">
                            {m.originalBody}
                          </div>
                        )}
                      </div>
                    )}
                    {emailsIn(m.body).length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{emailsIn(m.body).map((email) => {
                      const done = copiedEmail === `${m.id}:${email}`;
                      return <button key={email} onClick={() => copyEmail(email, m.id)} title="Copy email and remember this conversation" className={`rounded-md px-2 py-1 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${m.direction === "out" ? "bg-white/20 text-current hover:bg-white/30" : "bg-accent/10 text-accent hover:bg-accent/20"}`}>{done ? "Copied · source saved" : `Copy ${email}`}</button>;
                    })}</div>}
                    {!!m.reactions?.length && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.reactions.map((reaction) => {
                          const supported = QUICK_REACTIONS.some(
                            (emoji) => emoji === reaction.emoji
                          );
                          const selected = reaction.who.includes("You");
                          const className = `inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs leading-none transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                            selected
                              ? "bg-accent/15 ring-1 ring-accent/40"
                              : m.direction === "out"
                                ? "bg-white/10 text-current"
                                : "bg-slate-100 text-slate-600 dark:bg-[#272727] dark:text-neutral-200"
                          }`;
                          const content = (
                            <>
                              <span>
                                {reaction.emoji.startsWith("custom:")
                                  ? "\u2b50"
                                  : reaction.emoji}
                              </span>
                              {reaction.count > 1 && (
                                <span className="tabular-nums opacity-70">
                                  {reaction.count}
                                </span>
                              )}
                            </>
                          );
                          return canReactConversation && supported ? (
                            <button
                              key={reaction.emoji}
                              type="button"
                              onClick={() => reactToMessage(m, reaction.emoji)}
                              disabled={reactingMessageId === m.id}
                              title={
                                selected
                                  ? "Remove your reaction"
                                  : reaction.who.length
                                    ? reaction.who.join(", ")
                                    : "Add this reaction"
                              }
                              aria-label={`${selected ? "Remove" : "Add"} ${reaction.emoji} reaction`}
                              className={`${className} hover:ring-1 hover:ring-accent/40 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50`}
                            >
                              {content}
                            </button>
                          ) : (
                            <span
                              key={reaction.emoji}
                              title={
                                reaction.who.length
                                  ? reaction.who.join(", ")
                                  : undefined
                              }
                              className={className}
                            >
                              {content}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {pinError?.messageId === m.id && (
                      <div className="mt-2 text-xs font-medium text-red-600 dark:text-red-300" role="alert">
                        {pinError.message}
                      </div>
                    )}
                    {reactionError?.messageId === m.id && (
                      <div role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">
                        {reactionError.message}
                      </div>
                    )}
                  </div>
                    <div
                      className={`${showTimestamp ? `message-meta mt-1 text-xs tabular-nums ${!conversation.isGroup && inbound ? "text-left" : "text-right"}` : "sr-only"} ${
                        m.direction === "out"
                          ? deliveryStatus === "failed"
                            ? "text-red-700 dark:text-red-300"
                            : deliveryStatus === "unconfirmed"
                              ? "text-amber-700 dark:text-amber-300"
                              : deliveryStatus === "sending" || deliveryStatus === "pending"
                                ? "text-slate-500 dark:text-neutral-400"
                                : "text-slate-500 dark:text-neutral-400"
                          : "text-slate-400 dark:text-neutral-500"
                      }`}
                      aria-live={
                        deliveryStatus === "unconfirmed" || deliveryStatus === "failed"
                          ? "polite"
                          : undefined
                      }
                    >
                      <time dateTime={m.createdAt}>{clockTime(m.createdAt)}</time>
                      {!conversation.isGroup && (deliveryStatus === "sending" || deliveryStatus === "pending") && (
                        <span> · Sending…</span>
                      )}
                      {conversation.platform === "x" && deliveryStatus === "sent" && m.externalKey?.includes(":pending:") && (
                        <span title="X accepted this message. Waiting for its final message confirmation."> · Sent to X</span>
                      )}
                      {(deliveryStatus === "unconfirmed" || deliveryStatus === "failed") && (
                        <button
                          className="ml-1 font-semibold underline"
                          title={m.deliveryError || undefined}
                          onClick={() => {
                            setDraft(m.originalBody || m.body);
                            setAttachError(null);
                            setComposerNotice(
                              deliveryStatus === "unconfirmed"
                                ? `Check ${PLATFORMS[conversation.platform].label} first. If the message is absent, press Send.`
                                : "Message restored. Press Send to retry."
                            );
                            requestAnimationFrame(() => textareaRef.current?.focus());
                          }}
                        >
                          {deliveryStatus === "unconfirmed"
                            ? "Delivery unknown · review"
                            : "Not sent · edit and resend"}
                        </button>
                      )}
                    </div>
                  </div>
                  {inbound && (
                    <MenuDetails className="message-actions">
                      <summary aria-label={`Message actions for ${clockTime(m.createdAt)}`} title="Message actions" className="message-actions-trigger list-none [&::-webkit-details-marker]:hidden"><MoreIcon className="h-4 w-4" /></summary>
                      <div className="workspace-menu absolute bottom-full right-0 z-30 mb-1 flex items-center p-1">

                    {!readOnly && m.body && (
                      <button
                        type="button"
                        onClick={() => translateIncomingMessage(m)}
                        disabled={translationPending}
                        title={
                          translationConfig.enabled && m.translatedBody
                            ? shownTranslations.has(m.id)
                              ? "Hide original message"
                              : "View original message"
                            : m.translatedBody && shownTranslations.has(m.id)
                              ? "Hide translation"
                              : translationPending
                                ? "Translating to English"
                                : "Translate to English"
                        }
                        aria-label={
                          translationConfig.enabled && m.translatedBody
                            ? shownTranslations.has(m.id)
                              ? "Hide original message"
                              : "View original message"
                            : "Translate message to English"
                        }
                        className="rounded-full p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-accent disabled:cursor-wait disabled:opacity-50 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-accent"
                      >
                        <GlobeIcon className={`h-4 w-4 ${translationPending ? "animate-pulse" : ""}`} />
                      </button>
                    )}
                    <ReactionAction message={m} align="left" />
                    {(["telegram", "whatsapp"] as string[]).includes(conversation.platform) && <button data-close-menu onClick={() => { setReplyingTo(m); textareaRef.current?.focus(); }} title="Reply" className="rounded-full p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-700"><ReplyIcon className="h-4 w-4" /></button>}
                    <PinAction message={m} />
                    <button data-close-menu onClick={() => setForwardMsg(m)} title="Forward" className="rounded-full p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-700">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <polyline points="15 17 20 12 15 7" />
                        <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                      </svg>
                    </button>

                      </div>
                    </MenuDetails>
                  )}
                  {translationMessageError?.messageId === m.id && (
                    <div className={`mb-1 max-w-56 text-xs leading-5 text-red-600 dark:text-red-300 ${inbound ? "order-last" : "order-first"}`} role="alert">
                      {translationMessageError.message}
                    </div>
                  )}
                </motion.div>
              </Fragment>
            );
          })}
          </>
        )}
        </div>
      </div>
      <AnimatePresence>
        {showScrollToLatest && !loading && messages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center"
          >
            <button
              type="button"
              onClick={scrollToLatest}
              className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-white text-slate-700 shadow-lg ring-1 ring-slate-200 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-[#272727] dark:text-neutral-100 dark:ring-neutral-700 dark:hover:bg-[#313131]"
              aria-label="Jump to latest messages"
              title="Jump to latest messages"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="m6 13 6 6 6-6" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Composer */}
      {readOnly || !canSyncConversation || discordSearchChat ? (
        <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 py-3 text-center text-xs font-medium text-slate-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
          <span>
            {discordSearchChat ? syncStatus?.state === "ready" ? "Discord search · live updates · reply in Discord" : "Discord search · saved messages · checking connection"
              : !canSyncConversation
              ? "Legacy Discord archive · saved messages are read only"
              : "Read-only guest view · messages update live"}
          </span>
          {discordArchiveLinks && (
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={discordArchiveLinks.app}
                className="shrink-0 rounded-lg bg-[#5865f2] px-3 py-2 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#5865f2] focus:ring-offset-2 dark:focus:ring-offset-neutral-900"
              >
                Open Discord app
              </a>
              <a
                href={discordArchiveLinks.web}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                Browser
              </a>
            </div>
          )}
        </div>
      ) : (
      <div className="composer-surface">
        {replyingTo && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-neutral-700 dark:bg-[#1F1F1F]">
            <ReplyIcon className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-700 dark:text-neutral-200">Replying to {replyingTo.direction === "out" ? "yourself" : replyingTo.senderName || conversation.contact.name}</div>
              <div className="truncate text-xs text-slate-400 dark:text-neutral-500">{replyingTo.body || (replyingTo.mediaType ? MEDIA_LABEL[replyingTo.mediaType] : "Message")}</div>
            </div>
            <button onClick={() => setReplyingTo(null)} className="rounded-md px-2 py-1 text-xs text-slate-400 transition-colors duration-200 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200" aria-label="Cancel reply">×</button>
          </div>
        )}
        {dateMsg && calDismissed !== dateMsg.id && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
            <span className="text-base leading-none">📅</span>
            <span className="flex-1 text-slate-600 dark:text-neutral-300">
              Looks like a date came up — share your Cal.com link?
              {conversation.contact.email
                ? ` Invites ${conversation.contact.email}.`
                : ""}
            </span>
            <button
              onClick={insertCalLink}
              className="shrink-0 rounded-md bg-accent px-2.5 py-1 font-semibold text-accent-fg transition hover:opacity-90"
            >
              Insert link
            </button>
            <button
              onClick={() => setCalDismissed(dateMsg.id)}
              className="shrink-0 text-slate-400 transition hover:text-slate-600 dark:hover:text-neutral-300"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {/* "/" snippet menu */}
        <AnimatePresence>
          {slashOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="absolute bottom-full left-4 right-4 mx-auto mb-2 max-h-72 max-w-3xl origin-bottom overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-neutral-700">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                  <ZapIcon className="h-3.5 w-3.5" />
                  Snippets
                </span>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onManageSnippets();
                  }}
                  className="text-[11px] font-medium text-accent hover:underline dark:text-accent"
                >
                  Manage
                </button>
              </div>
              <div className="scroll-thin max-h-56 overflow-y-auto p-1">
                {slashResults.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-neutral-500">
                    {snippets.length === 0
                      ? "No snippets yet — click Manage to add one."
                      : "No match."}
                  </div>
                )}
                {slashResults.map((s, i) => (
                  <button
                    key={s.id}
                    onMouseEnter={() => setSlashIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertSnippet(s, true);
                    }}
                    className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                      i === slashIndex
                        ? "bg-accent/15 dark:bg-accent/15"
                        : "hover:bg-slate-100 dark:hover:bg-neutral-700/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800 dark:text-neutral-100">
                        {s.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500 dark:text-neutral-400">
                        {s.text}
                      </span>
                    </span>
                    {s.shortcut && (
                      <kbd className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-neutral-700 dark:text-neutral-300">
                        {IS_MAC ? "⌘" : "Ctrl"}
                        {s.shortcut.toUpperCase()}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mentionMatch && (
            <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} className="absolute bottom-full left-16 right-16 mb-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
              {mentionResults.length ? mentionResults.map((member, index) => (
                <button key={member.id} onMouseEnter={() => setMentionIndex(index)} onMouseDown={(e) => { e.preventDefault(); pickMention(member); }} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 ${index === mentionIndex ? "bg-slate-100 dark:bg-neutral-700" : "hover:bg-slate-50 dark:hover:bg-neutral-700/60"}`}>
                  <Avatar name={member.name} platform={conversation.platform} size="xs" src={member.avatarUrl || undefined} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{member.name}</span><span className="block truncate text-xs text-slate-400">{member.handle}</span></span>
                </button>
              )) : <div className="px-3 py-4 text-center text-xs text-slate-400">No matching group member</div>}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attachment preview / error */}
        <AnimatePresence>
          {attachment && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="mx-auto mb-2 flex max-w-3xl items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {mimeToMediaType(attachment.type) === "image" && attachmentUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachmentUrl}
                  alt=""
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded-lg bg-slate-200 text-slate-500 dark:bg-neutral-700 dark:text-neutral-400">
                  <PaperclipIcon className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-700 dark:text-neutral-200">
                  {attachment.name}
                </div>
                <div className="text-xs text-slate-400 dark:text-neutral-500">
                  {(attachment.size / 1024).toFixed(0)} KB ·{" "}
                  {mimeToMediaType(attachment.type)}
                </div>
              </div>
              <button
                onClick={clearAttachment}
                aria-label="Remove attachment"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
              >
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {attachError && (
          <div className="mx-auto mb-2 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/15 dark:text-red-400">
            {attachError}
          </div>
        )}
        {aiDraftError && !attachError && (
          <div
            className="mx-auto mb-2 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
            role="alert"
          >
            {aiDraftError}
          </div>
        )}
        {composerNotice && !attachError && !aiDraftError && (
          <div
            className="mx-auto mb-2 max-w-3xl rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
            role="status"
          >
            {composerNotice}
          </div>
        )}
        {autoCorrectionNotice && !attachError && !aiDraftError && (
          <div
            className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-slate-700 dark:text-neutral-200"
            role="status"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-accent">Corrected</span>{" "}
              {autoCorrectionSummary(autoCorrectionNotice.corrections)}
            </span>
            <button
              type="button"
              onClick={() => {
                const previousDraft = autoCorrectionNotice.before;
                lastAutocorrectedDraftRef.current = previousDraft;
                draftRef.current = previousDraft;
                setDraft(previousDraft);
                setAutoCorrectionNotice(null);
                requestAnimationFrame(() => {
                  textareaRef.current?.focus();
                  textareaRef.current?.setSelectionRange(
                    previousDraft.length,
                    previousDraft.length
                  );
                });
              }}
              className="shrink-0 rounded-md px-2 py-1 font-semibold text-accent transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent/10 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Undo
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={caps.accept}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />

        {draft.trim() && (
          <div className="mx-auto mb-1 max-w-3xl px-2 text-right text-[11px] font-medium text-slate-400 dark:text-neutral-500">
            {autoCorrecting
              ? "Checking spelling…"
              : autoCorrectEnabled && containsMention(draft)
                ? "Autocorrect paused for mentions"
                : "Draft saved"}
          </div>
        )}
        <div className="composer-card" data-compact-composer data-expanded={composerExpanded || undefined}>
          <AutoGrowTextarea
            ref={textareaRef}
            onMultilineChange={multiline => {
              // Keep the expanded layout stable when the wider line wraps less.
              if (multiline) setComposerExpanded(true);
              else if (draft.length < 40 && !draft.includes("\n")) setComposerExpanded(false);
            }}
            value={draft}
            onChange={(e) => {
              const nextDraft = e.target.value;
              draftRef.current = nextDraft;
              setDraft(nextDraft);
              if (conversation.platform === "whatsapp") {
                setSelectedMentions((items) =>
                  items.filter((external) =>
                    nextDraft.includes(`@${external.replace(/@.*$/, "")}`)
                  )
                );
              }
              setAutoCorrectionNotice(null);
              setComposerNotice(null);
              setAiDraftError(null);
            }}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // Cmd/Ctrl + <key> inserts the matching snippet.
              if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.length === 1) {
                const s = snippets.find(
                  (x) => x.shortcut && x.shortcut === e.key.toLowerCase()
                );
                if (s) {
                  e.preventDefault();
                  insertSnippet(s);
                  return;
                }
              }
              // Slash-menu navigation takes over Enter/Arrows.
              if (mentionMatch && mentionResults.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionResults.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionResults.length) % mentionResults.length); return; }
                if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) { e.preventDefault(); pickMention(mentionResults[mentionIndex]); return; }
                if (e.key === "Escape") { e.preventDefault(); setDraft(draft.replace(/@[^\s@]*$/, "")); return; }
              }
              if (slashOpen && slashResults.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashResults.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex(
                    (i) => (i - 1 + slashResults.length) % slashResults.length
                  );
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  insertSnippet(slashResults[slashIndex], true);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft("");
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            minRows={1}
            placeholder={
              translationConfig.enabled && translationConfig.languageName
                ? `Write in English · sends in ${translationConfig.languageName}…`
                : `Write a message…`
            }
            aria-label={
              translationConfig.enabled && translationConfig.languageName
                ? `Write in English to send in ${translationConfig.languageName}`
                : `Message on ${platform.label}`
            }
            className="resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <div className="composer-toolbar">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="composer-tool" title={caps.hint} aria-label="Attach a file"><PaperclipIcon className="h-4 w-4" /></button>
            <div className="relative">
              <button type="button" onClick={() => setShowEmoji(value => !value)} className="composer-tool" title="Add emoji" aria-label="Add emoji" aria-expanded={showEmoji}><SmileyIcon className="h-4 w-4" /></button>
              <AnimatePresence>{showEmoji && <EmojiPicker onPick={e => insertText(e)} onClose={() => { setShowEmoji(false); textareaRef.current?.focus(); }} />}</AnimatePresence>
            </div>
            <MenuDetails className="composer-disclosure relative">
                      <summary aria-label="Writing tools" title="AI, autocorrect and snippets" className="composer-tool list-none cursor-pointer [&::-webkit-details-marker]:hidden"><SparklesIcon className="h-4 w-4" /></summary>
              <div className="workspace-menu absolute bottom-full left-0 z-40 mb-3 w-64 p-2">
                <button type="button" data-close-menu onClick={event => { void generateAiDraft(); }} disabled={aiDrafting || loading || messages.length === 0 || (!draft.trim() && conversation.lastDirection !== "in")} className="composer-menu-item disabled:opacity-40"><SparklesIcon /><span>{aiDrafting ? "Writing…" : draft.trim() ? "Polish draft with AI" : "Draft reply with AI"}</span></button>
                <button type="button" aria-pressed={autoCorrectEnabled} onClick={() => {
                  const next = !autoCorrectEnabled;
                  setAutoCorrectEnabled(next);
                  window.localStorage.setItem(AUTOCORRECT_STORAGE_KEY, String(next));
                  setComposerNotice(next ? "Local autocorrect on" : "Local autocorrect off");
                }} className="composer-menu-item"><span>Local autocorrect</span><span className="text-xs text-accent">{autoCorrecting ? "Checking…" : autoCorrectEnabled ? "On" : "Off"}</span></button>
                <button type="button" data-close-menu onClick={event => { onManageSnippets(); }} className="composer-menu-item"><ZapIcon /> Snippets</button>
              </div>
            </MenuDetails>
          <WisprDictation key={conversation.id} conversationId={conversation.id} onInsert={(transcript) => {
            const next = appendDictation(draftRef.current, transcript);
            draftRef.current = next;
            setDraft(next);
            setComposerNotice("Dictation added to your draft. Review before sending.");
            requestAnimationFrame(() => textareaRef.current?.focus());
          }} />
          </div>
          <div className="composer-actions">
          <span className="composer-platform hidden text-xs text-slate-400 dark:text-neutral-500">{platform.label}</span>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={send}
            disabled={!draft.trim() && !attachment}
            title="Send"
            aria-label="Send message"
            className="composer-send flex h-8 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-80 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#1F1F1F]"
          >
            <span className="sr-only">Send</span><SendIcon className="h-4 w-4" />
          </motion.button>
          </div>
        </div>
      </div>
      )}

      <AnimatePresence>
        {spotlightImage && (
          <OverlayPortal onClose={() => setSpotlightImage(null)}><motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-8 backdrop-blur-xl"
            role="dialog" aria-modal="true" aria-label="Image preview"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setSpotlightImage(null); }}
          >
            <motion.img
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              src={spotlightImage} alt="Full size attachment" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
            <div className="absolute right-6 top-6 flex items-center gap-2">
              <a href={spotlightImage} download className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur-xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/20 active:scale-[0.98]">Download</a>
              <button onClick={() => setSpotlightImage(null)} className="grid h-10 w-10 place-items-center rounded-lg bg-white/10 text-xl text-white backdrop-blur-xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/20 active:scale-[0.98]" aria-label="Close image">×</button>
            </div>
          </motion.div></OverlayPortal>
        )}
        {spotlightVideo && (
          <VideoSpotlight
            url={spotlightVideo.url}
            name={spotlightVideo.name}
            isGif={spotlightVideo.isGif}
            onClose={() => setSpotlightVideo(null)}
          />
        )}
        {pdfPreview && (
          <PdfPreview
            url={pdfPreview.url}
            name={pdfPreview.name}
            onClose={() => setPdfPreview(null)}
          />
        )}
        {forwardMsg && (
          <ForwardModal
            message={forwardMsg}
            onClose={() => setForwardMsg(null)}
            onDone={() => setForwardMsg(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function VideoSpotlight({
  url,
  name,
  isGif = false,
  onClose,
}: {
  url: string;
  name: string;
  isGif?: boolean;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <OverlayPortal onClose={onClose}><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Video preview: ${name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-5xl overflow-hidden rounded-xl bg-[#181818] ring-1 ring-white/10"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 text-white">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
          <a
            href={downloadSource(url)}
            download={name}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/20 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Download ${name}`}
            title="Download video"
          >
            <DownloadIcon className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/20 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close video"
          >
            ×
          </button>
        </div>
        <div className="relative aspect-video bg-black">
          {failed ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-neutral-300" role="alert">
              This video could not be played. Try downloading it instead.
            </div>
          ) : (
            <video
              src={url}
              controls
              autoPlay
              muted={isGif}
              loop={isGif}
              playsInline
              preload="auto"
              onError={() => setFailed(true)}
              className="h-full w-full object-contain"
              aria-label={`Play ${name}`}
            />
          )}
        </div>
      </motion.div>
    </motion.div></OverlayPortal>
  );
}

function MediaContent({
  message,
  onOpenImage,
  onOpenVideo,
  onOpenPdf,
  onRecoverMissing,
  onAutoRecover,
  recovering = false,
}: {
  message: MessageDTO;
  onOpenImage: (url: string) => void;
  onOpenVideo: (url: string, name: string, isGif?: boolean) => void;
  onOpenPdf: (url: string, name: string) => void;
  onRecoverMissing?: () => Promise<void>;
  onAutoRecover?: () => Promise<void>;
  recovering?: boolean;
}) {
  const { mediaType, mediaUrl, mediaName } = message;
  const isGif = isGifMedia(message);
  const [loadFailed, setLoadFailed] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const source = mediaSource(message);
  const autoRef = useRef<HTMLDivElement>(null);
  const autoCallback = useRef(onAutoRecover);
  const autoAttempted = useRef(false);
  autoCallback.current = onAutoRecover;
  const [autoState, setAutoState] = useState<"idle" | "loading" | "failed">("idle");
  const needsLoad = !source || loadFailed;
  const canAutoRecover = !!onAutoRecover;

  useEffect(() => {
    if (!canAutoRecover || !needsLoad || !autoRef.current) return;
    // A decoder error after a successful fetch must not start an endless loop.
    if (autoAttempted.current) { setAutoState("failed"); return; }
    let mounted = true;
    let visible = false;
    let attempted = false;
    const start = () => {
      if (!visible || attempted || document.visibilityState !== "visible") return;
      attempted = true;
      autoAttempted.current = true;
      setAutoState("loading");
      void visibleMediaQueue.run(message.id,
        () => mounted && visible && document.visibilityState === "visible",
        () => autoCallback.current!()
      ).then(loaded => {
        if (!mounted) return;
        if (loaded) { setLoadFailed(false); setRetry(value => value + 1); }
        else { attempted = false; autoAttempted.current = false; }
        setAutoState("idle");
      }).catch(() => {
        if (mounted) setAutoState("failed");
      });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    observer.observe(autoRef.current);
    document.addEventListener("visibilitychange", start);
    return () => { mounted = false; observer.disconnect(); document.removeEventListener("visibilitychange", start); };
  }, [canAutoRecover, needsLoad, message.id]);

  useEffect(() => {
    setLoadFailed(false);
    setRecoveryError(null);
    setRetry(0);
  }, [mediaUrl]);

  if (!mediaType) return null;

  if (needsLoad && canAutoRecover) {
    const label = mediaType === "sticker" ? "sticker" : "GIF";
    const busy = autoState === "loading" || recovering;
    return (
      <div ref={autoRef} aria-busy={busy}
        className={`mb-1 flex max-w-full flex-col items-center justify-center gap-2 rounded-xl bg-black/5 p-3 text-center text-xs dark:bg-white/5 ${mediaType === "sticker" ? "min-h-28 w-28" : "aspect-video w-64"}`}>
        {autoState !== "failed" ? (
          <span role="status" className="text-slate-500 dark:text-neutral-400">
            {busy ? `Loading ${label}…` : label === "GIF" ? "GIF" : "Sticker"}
          </span>
        ) : (
          <>
            <span className="text-slate-500 dark:text-neutral-400">Couldn&apos;t load {label}.</span>
            <button type="button" disabled={busy} onClick={async () => {
              setRecoveryError(null);
              try { await onRecoverMissing?.(); setLoadFailed(false); setRetry(value => value + 1); }
              catch (error) { setRecoveryError(error instanceof Error ? error.message : "Try again later."); }
            }} aria-label={`Retry loading ${label}`}
              className="rounded-lg px-3 py-2 font-semibold text-slate-700 transition-colors hover:bg-black/10 active:bg-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-white/10">
              {busy ? "Loading…" : "Try again"}
            </button>
            {recoveryError && <span role="alert" className="break-words text-red-600 dark:text-red-300">{recoveryError}</span>}
          </>
        )}
      </div>
    );
  }

  // Old syncs can contain the message record without its binary attachment.
  if (!source) {
    if (mediaType === "video") {
      return (
        <div className="mb-1 w-80 max-w-full overflow-hidden rounded-xl bg-[#181818] text-white ring-1 ring-black/10 dark:ring-white/10">
          <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-base">
              ▶
            </span>
            <span className="mt-3 text-sm font-semibold">Video is not downloaded yet</span>
            <span className="mt-1 max-w-sm text-xs text-neutral-400">
              Fetch this exact attachment from the connected account to watch it here.
            </span>
            {onRecoverMissing && (
              <button
                type="button"
                onClick={async () => {
                  setRecoveryError(null);
                  try {
                    await onRecoverMissing();
                  } catch (error) {
                    setRecoveryError(
                      error instanceof Error
                        ? error.message
                        : "The video could not be recovered."
                    );
                  }
                }}
                disabled={recovering}
                className="mt-4 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-neutral-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {recovering ? "Fetching video…" : "Fetch and play"}
              </button>
            )}
            {recoveryError && (
              <span className="mt-3 max-w-sm text-xs text-red-300" role="alert">
                {recoveryError}
              </span>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="mb-1 flex min-w-56 flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-black/5 px-3 py-2.5 text-xs dark:border-white/10 dark:bg-white/5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/5 dark:bg-white/5">
          <PaperclipIcon className="h-4 w-4 opacity-60" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {mediaName || `${MEDIA_LABEL[mediaType]} unavailable`}
          </span>
          <span className="mt-0.5 block opacity-60">Attachment was not included in the last sync.</span>
        </span>
        {onRecoverMissing && (
          <button
            type="button"
            onClick={async () => {
              setRecoveryError(null);
              try {
                await onRecoverMissing();
                setLoadFailed(false);
                setRetry((value) => value + 1);
              } catch (error) {
                setRecoveryError(
                  error instanceof Error
                    ? error.message
                    : "The attachment could not be recovered."
                );
              }
            }}
            disabled={recovering}
            className="shrink-0 rounded-lg bg-black/10 px-3 py-2 font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-black/15 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/15"
          >
            {recovering ? "Checking…" : "Recover"}
          </button>
        )}
        {recoveryError && (
          <span className="basis-full text-xs text-red-600 dark:text-red-300" role="alert">
            {recoveryError}
          </span>
        )}
      </div>
    );
  }

  const retrySource =
    retry > 0 && !source.startsWith("blob:") && !source.startsWith("data:")
      ? `${source}${source.includes("?") ? "&" : "?"}retry=${retry}`
      : source;
  if (loadFailed) {
    return (
      <div className="mb-1 flex min-w-56 flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-black/5 px-3 py-2.5 text-xs dark:border-white/10 dark:bg-white/5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/5 dark:bg-white/5">
          <PaperclipIcon className="h-4 w-4 opacity-60" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{mediaName || MEDIA_LABEL[mediaType]}</span>
          <span className="mt-0.5 block opacity-60">Couldn&apos;t display this attachment.</span>
        </span>
        {onRecoverMissing ? (
          <button
            type="button"
            onClick={async () => {
              setRecoveryError(null);
              try {
                await onRecoverMissing();
                setLoadFailed(false);
                setRetry((value) => value + 1);
              } catch (error) {
                setRecoveryError(
                  error instanceof Error
                    ? error.message
                    : "The attachment could not be recovered."
                );
              }
            }}
            disabled={recovering}
            className="shrink-0 rounded-lg bg-black/10 px-3 py-2 font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-black/15 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/15"
          >
            {recovering ? "Recovering…" : mediaType === "sticker" ? "Recover sticker" : "Recover"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              setRetry((value) => value + 1);
            }}
            className="shrink-0 rounded-lg bg-black/10 px-3 py-2 font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-black/15 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/10 dark:hover:bg-white/15"
          >
            Try again
          </button>
        )}
        {recoveryError && (
          <span className="basis-full text-xs text-red-600 dark:text-red-300" role="alert">
            {recoveryError}
          </span>
        )}
      </div>
    );
  }

  const wrap = "mb-1 overflow-hidden rounded-lg";
  switch (mediaType === "file" && isGifMedia({ mediaName, mediaUrl }) ? "image" : mediaType) {
    case "image":
      return (
        <button type="button" onClick={() => onOpenImage(retrySource)} className={`block cursor-zoom-in text-left ${wrap}`} aria-label="Open image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={retrySource}
            alt="Message attachment"
            loading="lazy"
            decoding="async"
            onError={() => setLoadFailed(true)}
            className="max-h-80 max-w-full rounded-lg object-contain"
          />
        </button>
      );
    case "sticker":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={retrySource}
          alt="sticker"
          loading="lazy"
          decoding="async"
          onError={() => setLoadFailed(true)}
          className="mb-1 h-28 w-28 object-contain"
        />
      );
    case "video":
      return (
        <InlineVideoPlayer
          key={retrySource}
          source={retrySource}
          name={mediaName || (isGif ? "GIF" : "Video")}
          isGif={isGif}
          onError={() => setLoadFailed(true)}
          onOpen={() => onOpenVideo(retrySource, mediaName || (isGif ? "GIF" : "Video"), isGif)}
        />
      );
    case "audio":
      return <audio src={retrySource} controls preload="metadata" onError={() => setLoadFailed(true)} className="mb-1 w-56 max-w-full" />;
    case "file":
      if (isPdf(message)) {
        const name = mediaName || "Document.pdf";
        return (
          <div className="mb-1 flex min-w-64 items-center gap-3 rounded-xl border border-black/10 bg-black/5 p-2.5 dark:border-white/10 dark:bg-white/5">
            <button
              type="button"
              onClick={() => onOpenPdf(retrySource, name)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Open ${name}`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-500/15 text-[10px] font-bold tracking-wide text-red-600 dark:text-red-300">
                PDF
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{name}</span>
                <span className="mt-0.5 block text-[11px] opacity-60">Open preview</span>
              </span>
            </button>
            <a
              href={downloadSource(retrySource)}
              download={name}
              onClick={(event) => event.stopPropagation()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/5 transition hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/5 dark:hover:bg-white/10"
              aria-label={`Download ${name}`}
              title="Download"
            >
              <DownloadIcon className="h-4 w-4" />
            </a>
          </div>
        );
      }
      return (
        <a
          href={downloadSource(retrySource)}
          download={mediaName || true}
          className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs hover:bg-black/10"
        >
          <PaperclipIcon className="h-4 w-4 shrink-0 opacity-60" />
          <span className="truncate">{mediaName || "Download file"}</span>
          <DownloadIcon className="ml-auto h-4 w-4 shrink-0 opacity-60" />
        </a>
      );
  }
}
