"use client";

import { OverlayPortal } from "./OverlayPortal";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLATFORMS, PLATFORM_ORDER, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import { TelegramConnect } from "./TelegramConnect";
import { XConnect } from "./XConnect";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { SavedConnection } from "./ConnectSetup";
import { fetchJson } from "@/lib/fetch-json";

export type ConnState =
  | "starting"
  | "qr"
  | "ready"
  | "disconnected"
  | "disabled";

export interface ConnStatus {
  platform: Platform;
  state: ConnState;
  qr?: string | null;
  detail?: string;
  sync?: import("@/lib/sync-health").SyncHealth;
}

export interface ConnectionsData {
  workerRunning: boolean;
  platforms: Record<string, ConnStatus>;
}

const STATE_META: Record<ConnState, { label: string; color: string }> = {
  ready: { label: "Connected", color: "#22c55e" },
  qr: { label: "Scan to connect", color: "#f59e0b" },
  starting: { label: "Connecting…", color: "#3b82f6" },
  disconnected: { label: "Disconnected", color: "#ef4444" },
  disabled: { label: "Not connected", color: "#94a3b8" },
};

export function ConnectionsModal({
  data: initialData,
  onClose,
}: {
  data: ConnectionsData | null;
  onClose: () => void;
}) {
  const [data, setData] = useState(initialData);
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/connections", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Status unavailable");
        const current = await response.json();
        if (!cancelled) setData(current);
      } catch { if (!cancelled) setData(null); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Acct | null>(null);

  type Acct = {
    id: string;
    platform: string;
    label: string | null;
    status: string;
    detail: string | null;
    driver?: string | null;
  };
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [busyAcct, setBusyAcct] = useState(false);
  const [connectorPlatform, setConnectorPlatform] = useState<"x" | "discord" | null>(null);
  const [discordToken, setDiscordToken] = useState("");
  const [discordLabel, setDiscordLabel] = useState("");
  const [connectingDiscord, setConnectingDiscord] = useState(false);
  const [discordMessage, setDiscordMessage] = useState<string | null>(null);
  const [discordInstallUrl, setDiscordInstallUrl] = useState<string | null>(null);
  const accountRequest = useRef(false);
  const mounted = useRef(true);
  const workerRequest = useRef(false);
  const [accountError, setAccountError] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [startingWorker, setStartingWorker] = useState(false);
  const [workerMsg, setWorkerMsg] = useState<string | null>(null);

  const isLocal =
    typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(window.location.hostname);

  async function startWorker() {
    if (workerRequest.current) return;
    workerRequest.current = true; setStartingWorker(true); setWorkerMsg("Starting sync…");
    try {
      await fetchJson("/api/worker/start", { method: "POST", signal: AbortSignal.timeout(10_000) }, "Starting sync");
      if (mounted.current) setWorkerMsg("Start requested. Live connection status will update automatically.");
    } catch {
      if (mounted.current) setWorkerMsg("Could not start sync here. The server owner can run npm run sync. No need to sign in again.");
    } finally {
      workerRequest.current = false;
      if (mounted.current) setStartingWorker(false);
    }
  }

  async function loadAccounts() {
    if (accountRequest.current) return;
    accountRequest.current = true;
    try {
      const rows = await fetchJson<Acct[]>("/api/accounts", { signal: AbortSignal.timeout(6000) }, "Saved accounts");
      if (mounted.current) { setAccounts(rows); setAccountError(""); }
    } catch {
      if (mounted.current) setAccountError("Could not load saved accounts. Checking again shortly; your connections have not been removed.");
    } finally {
      accountRequest.current = false;
      if (mounted.current) setAccountsLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true; void loadAccounts();
    const timer = setInterval(() => void loadAccounts(), 5000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);

  // Live per-account state (state/qr/detail) from the worker, keyed by accountId.
  const live: Record<string, ConnStatus & { qr?: string | null }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of (((data?.platforms as any)?.accounts ?? []) as any[]))
    if (a?.accountId) live[a.accountId] = a;

  async function addAccount(platform: string) {
    if (platform === "gmail") {
      window.location.href = "/api/accounts/gmail/connect";
      return;
    }
    if (platform === "telegram") {
      setConnectingTelegram(true);
      return;
    }
    if (platform === "x") {
      // Reuse the guided pairing flow from onboarding.
      setConnectorPlatform(platform);
      return;
    }
    if (platform === "discord") {
      setConnectorPlatform("discord");
      setDiscordMessage(null);
      return;
    }
    setConnectingWhatsApp(true);
  }

  async function connectDiscord() {
    if (!discordToken.trim() || connectingDiscord) return;
    setConnectingDiscord(true);
    setDiscordMessage("Verifying the bot token with Discord…");
    setDiscordInstallUrl(null);
    try {
      const response = await fetch("/api/accounts/discord/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: discordToken, label: discordLabel }),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        installUrl?: string;
        workerReloaded?: boolean;
      };
      if (!response.ok) throw new Error(result.error || "Discord could not connect this bot.");
      setDiscordToken("");
      setDiscordInstallUrl(result.installUrl || null);
      setDiscordMessage(
        result.workerReloaded
          ? "Bot verified. Add it to your server, then it will begin importing readable channels."
          : "Bot verified. Add it to your server, then start the sync worker."
      );
      loadAccounts();
    } catch (error) {
      setDiscordMessage(error instanceof Error ? error.message : "Discord could not connect this bot.");
    } finally {
      setConnectingDiscord(false);
    }
  }

  async function removeAccount(id: string) {
    setBusyAcct(true);
    await fetch(`/api/accounts/${id}`, { method: "DELETE" }).catch(() => {});
    setBusyAcct(false);
    loadAccounts();
  }


  return (
    <OverlayPortal onClose={onClose}><motion.div role="dialog" aria-modal="true" aria-label="Connections"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-neutral-700 dark:bg-neutral-800">
          <h2 className="text-base font-semibold dark:text-neutral-100">Connections</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {data && !data.workerRunning && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <div>
              Sync worker isn&apos;t running.
              {!isLocal && (
                <>
                  {" "}Start it with{" "}
                  <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">npm run sync</code>{" "}
                  to connect your accounts.
                </>
              )}
            </div>
            {isLocal && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={startWorker}
                  disabled={startingWorker}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {startingWorker ? "Starting…" : "▶ Start sync"}
                </button>
                <span className="text-xs text-amber-700/90 dark:text-amber-300/80">
                  {workerMsg || "Runs npm run sync for you."}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Per-account management (multi-account) */}
        <div className="border-b border-slate-100 px-5 py-4 dark:border-neutral-700">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
            Your accounts
          </h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-neutral-400">Select an account to finish setup or check live sync.</p>
          {accountError && <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-400">{accountError}</p>}
          <div className="space-y-3">
            {accounts.length === 0 && !accountError && (
              <p className="text-xs text-slate-400 dark:text-neutral-500">
                {accountsLoading ? "Loading saved accounts…" : "No accounts yet — add one below."}
              </p>
            )}
            {PLATFORM_ORDER.filter((p) =>
              accounts.some((a) => a.platform === p)
            ).map((p) => {
              const group = accounts.filter((a) => a.platform === p);
              return (
                <div key={p}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="grid h-5 w-5 place-items-center rounded-full text-white"
                      style={{ backgroundColor: PLATFORMS[p].bg }}
                    >
                      <PlatformGlyph platform={p} className="h-3 w-3" />
                    </span>
                    <span className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                      {PLATFORMS[p].label}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-neutral-500">
                      {group.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.map((a) => {
                      const l = live[a.id];
                      const st: ConnState = l?.state ?? "disabled";
                      const meta = STATE_META[st] || STATE_META.disabled;
                      return (
                        <span
                          key={a.id}
                          title={l?.detail || a.detail || meta.label}
                          className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-2 pr-1 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: meta.color }}
                          />
                          <button type="button" onClick={() => setSelectedAccount(a)} aria-label={`Open ${a.label || PLATFORMS[p].label} setup`} className="max-w-[12rem] truncate rounded px-1 py-1 text-left transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:text-white">
                            {a.label || PLATFORMS[p].label} · {meta.label}
                          </button>
                          <button
                            onClick={() => removeAccount(a.id)}
                            disabled={busyAcct}
                            title="Remove account"
                            className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-slate-400 transition hover:bg-slate-200 hover:text-red-500 disabled:opacity-50 dark:text-neutral-500 dark:hover:bg-neutral-700"
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>

                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400 dark:text-neutral-500">Add another:</span>
            {PLATFORM_ORDER.map((p) => (
              <button
                key={p}
                onClick={() => addAccount(p)}
                disabled={busyAcct}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                <span
                  className="grid h-4 w-4 place-items-center rounded-full text-white"
                  style={{ backgroundColor: PLATFORMS[p].bg }}
                >
                  <PlatformGlyph platform={p} className="h-2.5 w-2.5" />
                </span>
                {PLATFORMS[p].label}
              </button>
            ))}
          </div>

          {connectorPlatform === "discord" && (
            <div className="mt-3 rounded-xl border border-[#5865f2]/30 bg-[#5865f2]/10 p-3 text-xs text-slate-700 dark:text-neutral-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Connect an official Discord bot</div>
                  <p className="mt-1 leading-relaxed text-slate-500 dark:text-neutral-400">
                    Create a bot, enable <b>Message Content Intent</b>, then paste its bot token below.
                  </p>
                </div>
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg border border-[#5865f2]/30 bg-white px-2.5 py-1.5 font-semibold text-[#5865f2] transition hover:bg-[#5865f2]/5 dark:bg-neutral-900"
                >
                  Developer Portal ↗
                </a>
              </div>
              <div className="mt-3 grid gap-2">
                <input
                  value={discordLabel}
                  onChange={(event) => setDiscordLabel(event.target.value)}
                  placeholder="Label (optional)"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none transition focus:border-[#5865f2] focus:ring-2 focus:ring-[#5865f2]/20 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <input
                  type="password"
                  value={discordToken}
                  onChange={(event) => setDiscordToken(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void connectDiscord();
                  }}
                  placeholder="Bot token"
                  autoComplete="new-password"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono outline-none transition focus:border-[#5865f2] focus:ring-2 focus:ring-[#5865f2]/20 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <button
                  type="button"
                  onClick={connectDiscord}
                  disabled={!discordToken.trim() || connectingDiscord}
                  className="rounded-lg bg-[#5865f2] px-3 py-2 font-semibold text-white transition hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connectingDiscord ? "Verifying…" : "Verify and connect bot"}
                </button>
              </div>
              {discordMessage && (
                <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 leading-relaxed dark:bg-neutral-900/70">
                  {discordMessage}
                </p>
              )}
              {discordInstallUrl && (
                <a
                  href={discordInstallUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center justify-center rounded-lg border border-[#5865f2]/30 bg-white px-3 py-2 font-semibold text-[#5865f2] transition hover:bg-[#5865f2]/5 dark:bg-neutral-900"
                >
                  Add bot to a Discord server ↗
                </a>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-neutral-400">
                The token is encrypted at rest. The bot can only read server channels it is invited to and permitted to view, plus DMs sent directly to the bot. Existing personal-account archives stay read-only.
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-slate-400 dark:text-neutral-500">
            Connections recover automatically after brief network loss or Mac
            wake. WhatsApp shows a QR here only when it needs to be linked again.
          </p>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-neutral-700">
          {PLATFORM_ORDER.map((p) => {
            const status = data?.platforms?.[p];
            const state: ConnState = status?.state ?? "disabled";
            const meta = STATE_META[state];
            const plat = PLATFORMS[p];
            return (
              <div key={p} className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: plat.bg }}
                  >
                    <PlatformGlyph platform={p} className="h-4 w-4" />
                  </span>
                  <div className="flex-1">
                    <div className="font-medium dark:text-neutral-100">{plat.label}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-neutral-400">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      {meta.label}
                      {status?.detail ? ` · ${status.detail}` : ""}
                    </div>
                  </div>
                  {p === "telegram" && (
                    <button
                      onClick={() => setConnectingTelegram(true)}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent"
                    >
                      {state === "ready" ? "Re-link" : "Connect"}
                    </button>
                  )}
                  {p === "x" && (
                    <button onClick={() => {
                      const existing = accounts.find(a => a.platform === "x");
                      if (existing && /lock|passcode/i.test(status?.detail || "")) setSelectedAccount(existing);
                      else setConnectorPlatform("x");
                    }} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg focus-visible:ring-2 focus-visible:ring-accent">
                      {/lock|passcode/i.test(status?.detail || "") ? "Unlock chats" : "Connect X"}
                    </button>
                  )}
                  {p === "discord" && (
                    <button
                      onClick={() => setConnectorPlatform("discord")}
                      className="rounded-lg bg-[#5865f2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4752c4]"
                    >
                      {state === "ready" ? "Reconnect" : "Connect bot"}
                    </button>
                  )}
                </div>

                {state === "qr" && status?.qr && !accounts.some((account) => account.platform === p) && (
                  <div className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-slate-50 p-4 dark:bg-neutral-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={status.qr}
                      alt="WhatsApp QR code"
                      className="h-56 w-56 rounded-lg bg-white"
                    />
                    <p className="text-center text-xs text-slate-500 dark:text-neutral-400">
                      On your phone: WhatsApp → <b>Settings</b> →{" "}
                      <b>Linked Devices</b> → <b>Link a Device</b>, then scan
                      this code.
                    </p>
                  </div>
                )}

                {state === "disconnected" && p !== "x" && p !== "whatsapp" && p !== "discord" && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                    {p === "telegram" && /reconnect Telegram/i.test(status?.detail || "")
                      ? "Telegram invalidated this saved login. Connect again once to create a fresh session."
                      : "Connection dropped. Restart the sync worker to reconnect."}
                  </p>
                )}

                {state === "disconnected" && p === "whatsapp" && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                    {status?.detail || "WhatsApp disconnected."} Open this account above to see its live QR when linking is available.
                  </p>
                )}

                {p === "discord" && (
                  <div className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                    state === "ready"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                      : state === "disconnected"
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  }`}>
                    {state === "ready" ? (
                      <><span className="font-semibold">Official bot connected.</span> New messages sync live; manual replies and history backfill are enabled in channels the bot can access.</>
                    ) : state === "disconnected" ? (
                      <><span className="font-semibold">Bot needs attention.</span> {status?.detail || "Check its token, Message Content Intent, and channel permissions."}</>
                    ) : (
                      <><span className="font-semibold">Connect an official bot.</span> Personal-account archives remain searchable but read-only.</>
                    )}
                  </div>
                )}

                {state === "disabled" &&
                  data?.workerRunning &&
                  p === "whatsapp" && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                      Choose WhatsApp under “Add another” above to open guided QR setup. No environment-file editing is needed.
                    </p>
                  )}
              </div>
            );
          })}
        </div>
      </motion.div>

      <AnimatePresence>
        {selectedAccount && <SavedConnection platform={selectedAccount.platform as Platform} accountId={selectedAccount.id} driver={selectedAccount.driver} onClose={() => setSelectedAccount(null)} />}
        {connectorPlatform === "x" && <XConnect onClose={() => { setConnectorPlatform(null); loadAccounts(); }} />}
        {connectingWhatsApp && <WhatsAppConnect onClose={() => { setConnectingWhatsApp(false); loadAccounts(); }} />}
        {connectingTelegram && (
          <TelegramConnect onClose={() => setConnectingTelegram(false)} />
        )}
      </AnimatePresence>
    </motion.div></OverlayPortal>
  );
}
