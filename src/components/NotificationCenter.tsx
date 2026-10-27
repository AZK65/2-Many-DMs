"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { KeywordNotificationDTO } from "@/lib/types";
import { BellIcon, CheckIcon, CloseIcon } from "./icons";

function notificationTime(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationCenter({
  onOpen,
  onNewNotifications,
}: {
  onOpen: (notification: KeywordNotificationDTO) => void;
  onNewNotifications?: (notifications: KeywordNotificationDTO[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const onNewNotificationsRef = useRef(onNewNotifications);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState<KeywordNotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onNewNotificationsRef.current = onNewNotifications;
  }, [onNewNotifications]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/keyword-alerts/notifications", {
        cache: "no-store",
      });
      const data = (await response.json()) as
        | KeywordNotificationDTO[]
        | { error?: string };
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(!Array.isArray(data) && data.error ? data.error : "Notifications could not load");
      }
      if (initializedRef.current) {
        const fresh = data.filter(
          (notification) =>
            !notification.readAt && !seenIdsRef.current.has(notification.id),
        );
        if (fresh.length) onNewNotificationsRef.current?.(fresh);
      } else {
        initializedRef.current = true;
      }
      seenIdsRef.current = new Set(data.map((notification) => notification.id));
      setNotifications(data);
      setError(null);
    } catch (reason) {
      if (!quiet)
        setError(reason instanceof Error ? reason.message : "Notifications could not load");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    const refresh = () => void load(true);
    window.addEventListener("omnicrm-keyword-alerts-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("omnicrm-keyword-alerts-changed", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const unread = notifications.filter((notification) => !notification.readAt).length;
  const visible = useMemo(
    () =>
      filter === "unread"
        ? notifications.filter((notification) => !notification.readAt)
        : notifications,
    [filter, notifications],
  );

  async function markRead(notification: KeywordNotificationDTO) {
    if (notification.readAt) return;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, readAt } : item,
      ),
    );
    await fetch("/api/keyword-alerts/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notification.id }),
    }).catch(() => void load(true));
  }

  async function markAllRead() {
    if (!unread) return;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, readAt })),
    );
    await fetch("/api/keyword-alerts/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => void load(true));
  }

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        whileTap={{ scale: 0.9 }}
        type="button"
        onClick={() => setOpen((current) => !current)}
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className={`relative grid h-9 w-9 place-items-center rounded-lg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open
            ? "bg-accent/15 text-accent"
            : "text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-fg ring-2 ring-white dark:ring-neutral-900">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="fixed left-3 top-16 z-50 flex max-h-[min(38rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-[#1F1F1F]"
            aria-label="Notifications panel"
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  Notifications
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                  Telegram keyword matches
                </p>
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    className="rounded-lg px-2 py-1.5 text-xs font-semibold text-accent transition-all duration-200 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  aria-label="Close notifications"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex gap-1 border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
              {(["all", "unread"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    filter === value
                      ? "bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-neutral-100"
                      : "text-slate-400 hover:text-slate-700 dark:text-neutral-500 dark:hover:text-neutral-200"
                  }`}
                >
                  {value === "all" ? "All" : `Unread${unread ? ` ${unread}` : ""}`}
                </button>
              ))}
            </div>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {loading && (
                <div className="space-y-3 p-4" aria-label="Loading notifications">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="animate-pulse">
                      <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-neutral-800" />
                      <div className="mt-2 h-3 w-full rounded bg-slate-100 dark:bg-neutral-800" />
                    </div>
                  ))}
                </div>
              )}
              {!loading && error && (
                <div className="p-6 text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-neutral-200">{error}</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-3 text-xs font-semibold text-accent"
                  >
                    Try again
                  </button>
                </div>
              )}
              {!loading && !error && visible.length === 0 && (
                <div className="px-6 py-10 text-center">
                  <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
                    <BellIcon className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">
                    {filter === "unread" ? "You’re caught up" : "No keyword matches yet"}
                  </p>
                  <p className="mx-auto mt-1 max-w-64 text-xs leading-5 text-slate-400 dark:text-neutral-500">
                    Add phrases from the bell inside any Telegram group chat.
                  </p>
                </div>
              )}
              {!loading && !error && visible.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    void markRead(notification);
                    setOpen(false);
                    onOpen(notification);
                  }}
                  className={`group flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-all duration-200 last:border-0 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:border-neutral-800 dark:hover:bg-[#272727] ${
                    notification.readAt ? "" : "bg-accent/5"
                  }`}
                >
                  <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${notification.readAt ? "bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500" : "bg-accent/15 text-accent"}`}>
                    {notification.readAt ? <CheckIcon className="h-3.5 w-3.5" /> : <BellIcon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900 dark:text-neutral-100">
                        {notification.groupName}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-slate-400 dark:text-neutral-500">
                        {notificationTime(notification.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-600 dark:text-neutral-300">
                      {notification.senderName && `${notification.senderName}: `}
                      {notification.preview}
                    </span>
                    <span className="mt-1.5 block truncate text-[11px] font-medium text-accent">
                      Matched “{notification.matchedPhrase}”
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
