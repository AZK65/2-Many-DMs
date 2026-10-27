"use client";

import { OverlayPortal } from "./OverlayPortal";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Platform } from "@/lib/platforms";
import { PLATFORMS } from "@/lib/platforms";
import { saveConversationDraft } from "@/lib/drafts";
import { PlatformGlyph } from "./PlatformIcon";
import { CloseIcon, SendIcon } from "./icons";

type DirectPlatform = Extract<Platform, "telegram" | "whatsapp">;

export type NewMessageRecipient = {
  platform: DirectPlatform;
  accountId: string | null;
  target: string;
  label: string;
};

type Account = {
  id: string;
  platform: Platform;
  label: string | null;
  status: string;
  detail: string | null;
};

const DIRECT_PLATFORMS: DirectPlatform[] = ["telegram", "whatsapp"];

export function NewMessageModal({
  onClose,
  onStarted,
  initialRecipient,
}: {
  onClose: () => void;
  onStarted: (conversationId: string) => Promise<void> | void;
  initialRecipient?: NewMessageRecipient | null;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [platform, setPlatform] = useState<DirectPlatform>(
    initialRecipient?.platform || "telegram"
  );
  const [accountId, setAccountId] = useState(initialRecipient?.accountId || "");
  const [target, setTarget] = useState(initialRecipient?.target || "");
  const [recipientSelected, setRecipientSelected] = useState(!!initialRecipient);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/accounts", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Accounts could not be loaded.");
        return (await response.json()) as Account[];
      })
      .then((loaded) => {
        const direct = loaded.filter(
          (account) =>
            DIRECT_PLATFORMS.includes(account.platform as DirectPlatform) &&
            (account.status === "connected" ||
              account.id === initialRecipient?.accountId)
        );
        setAccounts(direct);
        if (!direct.some((account) => account.platform === platform)) {
          const first = direct[0];
          if (first) setPlatform(first.platform as DirectPlatform);
        }
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Connected accounts could not be loaded.");
      })
      .finally(() => setAccountsLoaded(true));
    return () => controller.abort();
  }, []);

  const platformAccounts = useMemo(
    () => accounts.filter((account) => account.platform === platform),
    [accounts, platform]
  );

  useEffect(() => {
    if (!platformAccounts.some((account) => account.id === accountId)) {
      setAccountId(platformAccounts[0]?.id || "");
    }
  }, [accountId, platformAccounts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function switchPlatform(next: DirectPlatform) {
    setPlatform(next);
    setTarget("");
    setRecipientSelected(false);
    setError(null);
  }

  async function startConversation() {
    if (busy) return;
    if (!accountId) {
      setError(`Connect ${PLATFORMS[platform].label} before starting a message.`);
      return;
    }
    if (!target.trim()) {
      setError(
        platform === "telegram"
          ? "Enter an exact Telegram username."
          : "Enter a WhatsApp number with its country code."
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, accountId, target: target.trim() }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        conversationId?: string;
        error?: string;
      };
      if (!response.ok || !result.conversationId) {
        throw new Error(result.error || "The conversation could not be opened.");
      }
      if (message.trim()) saveConversationDraft(result.conversationId, message);
      await onStarted(result.conversationId);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The conversation could not be opened."
      );
      setBusy(false);
    }
  }

  const platformLabel = PLATFORMS[platform].label;

  return (
    <OverlayPortal onClose={busy ? undefined : onClose}><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-message-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 12 }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1F1F1F]"
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <div>
            <h2
              id="new-message-title"
              className="text-base font-semibold text-slate-900 dark:text-neutral-100"
            >
              {initialRecipient && recipientSelected
                ? `Message ${initialRecipient.label}`
                : "New message"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
              {initialRecipient && recipientSelected
                ? `Open their private ${PLATFORMS[platform].label} chat, then send when you’re ready.`
                : "Find the exact person, then finish the message in their chat."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label="Close new message"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-neutral-800">
            {DIRECT_PLATFORMS.map((id) => {
              const active = platform === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchPlatform(id)}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                      : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                  aria-pressed={active}
                >
                  <PlatformGlyph platform={id} className="h-4 w-4" />
                  {PLATFORMS[id].label}
                </button>
              );
            })}
          </div>

          {platformAccounts.length > 1 && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-neutral-300">
                Send from
              </span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {platformAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label || platformLabel}
                    {account.detail ? ` · ${account.detail}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {recipientSelected && initialRecipient ? (
            <div className="flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-accent shadow-sm dark:bg-neutral-800">
                <PlatformGlyph platform={platform} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  {initialRecipient.label}
                </div>
                <div className="text-xs text-slate-500 dark:text-neutral-400">
                  Tagged in this {PLATFORMS[platform].label} chat
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecipientSelected(false)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Change
              </button>
            </div>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-neutral-300">
                {platform === "telegram" ? "Telegram username" : "WhatsApp number"}
              </span>
              <input
                autoFocus
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void startConversation();
                  }
                }}
                inputMode={platform === "whatsapp" ? "tel" : "text"}
                autoComplete="off"
                placeholder={platform === "telegram" ? "@username" : "+1 647 555 0142"}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600"
              />
              <span className="mt-1.5 block text-xs text-slate-400 dark:text-neutral-500">
                {platform === "telegram"
                  ? "We’ll look up this exact username through your connected Telegram."
                  : "Include the country code. We’ll verify the number on WhatsApp first."}
              </span>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-neutral-300">
              Message <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              placeholder="Write a draft…"
              className="max-h-32 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600"
            />
            <span className="mt-1.5 block text-xs text-slate-400 dark:text-neutral-500">
              Nothing is sent until you press Send in the chat.
            </span>
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {accountsLoaded && platformAccounts.length === 0 && !error && (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              Connect {platformLabel} from Connections before starting a chat.
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void startConversation()}
            disabled={busy || !accountId || !target.trim()}
            className="flex min-w-36 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-[#1F1F1F]"
          >
            <SendIcon className="h-4 w-4" />
            {busy
              ? "Finding…"
              : initialRecipient && recipientSelected
                ? "Open private chat"
                : "Open conversation"}
          </button>
        </footer>
      </motion.div>
    </motion.div></OverlayPortal>
  );
}
