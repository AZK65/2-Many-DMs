"use client";

import { OverlayPortal } from "./OverlayPortal";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLATFORMS, PLATFORM_ORDER, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import { TelegramConnect } from "./TelegramConnect";
import { WhatsAppLinkCode } from "./WhatsAppLinkCode";

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
  const [unlocking, setUnlocking] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);

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
  const [startingWorker, setStartingWorker] = useState(false);
  const [workerMsg, setWorkerMsg] = useState<string | null>(null);

  const isLocal =
    typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(window.location.hostname);

  async function startWorker() {
    setStartingWorker(true);
    setWorkerMsg("Starting sync…");
    try {
      const d = await fetch("/api/worker/start", { method: "POST" }).then((r) =>
        r.json()
      );
      if (!d.ok) {
        setWorkerMsg(d.error || "Couldn't start the worker.");
        setStartingWorker(false);
        return;
      }
      // Poll until the worker's control server answers.
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        const up = await fetch("/api/worker/start")
          .then((r) => r.json())
          .then((j) => j.running)
          .catch(() => false);
        if (up) {
          clearInterval(iv);
          setWorkerMsg("✓ Sync running — connecting your accounts…");
          setStartingWorker(false);
        } else if (tries > 20) {
          clearInterval(iv);
          setWorkerMsg("Started — still coming up. Check sync.log if nothing connects.");
          setStartingWorker(false);
        }
      }, 1500);
    } catch {
      setWorkerMsg("Couldn't reach the server.");
      setStartingWorker(false);
    }
  }

  function loadAccounts() {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then(setAccounts)
      .catch(() => {});
  }
  useEffect(() => {
    loadAccounts();
    const t = setInterval(loadAccounts, 5000);
    return () => clearInterval(t);
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
      // The extension requests and consumes its own short-lived pairing code;
      // this panel only needs to guide the user to the correct connector tab.
      setConnectorPlatform(platform);
      return;
    }
    if (platform === "discord") {
      setConnectorPlatform("discord");
      setDiscordMessage(null);
      return;
    }
    // WhatsApp: create a pending account; the worker links it via QR on (re)start.
    setBusyAcct(true);
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    }).catch(() => {});
    setBusyAcct(false);
    loadAccounts();
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

  async function unlockXChat() {
    setUnlocking(true);
    setUnlockMsg(null);
    try {
      const res = await fetch("/api/accounts/x/unlock", { method: "POST" });
      const d = await res.json();
      setUnlockMsg(
        d.ok
          ? "Opening an X window on this machine — type your passcode there, then it'll reconnect. (No window? You're on a headless server — use the terminal command below.)"
          : `Couldn't start the unlock: ${d.error || "unknown error"}`,
      );
    } catch (e) {
      setUnlockMsg(`Couldn't reach the server: ${String(e)}`);
    } finally {
      setUnlocking(false);
    }
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
          <div className="space-y-3">
            {accounts.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-neutral-500">
                No accounts yet — add one below.
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
                          <span className="max-w-[10rem] truncate">
                            {a.label || PLATFORMS[p].label}
                          </span>
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
                  {group.map((a) => {
                    const l = live[a.id];
                    if (p !== "whatsapp" || (l?.state !== "qr" && l?.detail !== "Generating a new QR code")) return null;
                    return (
                      <div
                        key={a.id + "-qr"}
                        className="mt-2 flex flex-col items-center gap-1 rounded-lg bg-slate-50 p-3 dark:bg-neutral-900"
                      >
                        <WhatsAppLinkCode qr={l.qr} label={a.label || "WhatsApp"} accountId={a.id} canRefresh={a.driver === "web"} />
                      </div>
                    );
                  })}
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

          {connectorPlatform === "x" && (
            <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs text-slate-600 dark:text-neutral-300">
              Open <b>x.com</b>, make
              sure you&apos;re signed in, then open the <b>2 Many DMs Connector</b>
              extension and click <b>Connect my X account</b>.
              <div className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
                Pairing is automatic. The encrypted session appears here and the
                running worker starts its message backfill immediately.
              </div>
            </div>
          )}

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
                  {p === "x" && state === "disabled" && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-neutral-700 dark:text-neutral-400">
                      Not enabled
                    </span>
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

                {state === "disconnected" &&
                  p === "x" &&
                  /lock/i.test(status?.detail || "") && (
                    <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200/90">
                      <div className="flex items-start gap-2">
                        <span aria-hidden>🔒</span>
                        <div className="flex-1">
                          {/rejected/i.test(status?.detail || "") ? (
                            <>
                              <span className="font-semibold">
                                XChat passcode rejected.
                              </span>{" "}
                              X refused the code in{" "}
                              <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">
                                X_PASSCODE
                              </code>
                              . It won&apos;t be retried — repeat attempts trip
                              X&apos;s recovery lockout. Fix it in{" "}
                              <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">
                                .env
                              </code>{" "}
                              and restart the worker.
                            </>
                          ) : /no passcode/i.test(status?.detail || "") ? (
                            <>
                              <span className="font-semibold">
                                XChat is locked.
                              </span>{" "}
                              Set{" "}
                              <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">
                                X_PASSCODE
                              </code>{" "}
                              in{" "}
                              <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">
                                .env
                              </code>{" "}
                              to unlock automatically — that&apos;s how it works on
                              a headless server, where there&apos;s no window to
                              type into.
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">
                                XChat is locked.
                              </span>{" "}
                              X&apos;s encrypted DMs need a one-time unlock —
                              you&apos;ll type your passcode into X&apos;s own
                              window (we never see it).
                            </>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              onClick={unlockXChat}
                              disabled={unlocking}
                              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent disabled:opacity-60"
                            >
                              {unlocking ? "Opening…" : "Unlock XChat"}
                            </button>
                            <span className="text-amber-700/80 dark:text-amber-200/70">
                              or run{" "}
                              <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">
                                npm run x:unlock
                              </code>
                            </span>
                          </div>
                          {unlockMsg && (
                            <p className="mt-2 text-amber-700 dark:text-amber-200/80">
                              {unlockMsg}
                            </p>
                          )}
                          <p className="mt-2 text-amber-700/80 dark:text-amber-200/70">
                            Tip: only <b>encrypted XChat</b> needs this. For classic
                            DMs set{" "}
                            <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">
                              X_DRIVER=api
                            </code>{" "}
                            — no passcode at all.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                {state === "disconnected" &&
                  p === "x" &&
                  !/lock/i.test(status?.detail || "") && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                      No X session. Connect the <b>Chrome extension</b> (it hands
                      off your cookies), or set{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_AUTH_TOKEN</code>{" "}
                      +{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_CT0</code>{" "}
                      in <code>.env</code>, then restart the worker.
                    </p>
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
                    {status?.detail || "WhatsApp disconnected."} A fresh QR will
                    appear here automatically if the linked-device session was
                    logged out.
                  </p>
                )}

                {state === "disabled" && data?.workerRunning && p === "x" && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                    Set <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_ENABLED=1</code>.
                    For the lightweight browser-free driver (classic DMs, no
                    passcode) add{" "}
                    <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_DRIVER=api</code>{" "}
                    + your{" "}
                    <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_AUTH_TOKEN</code>/<code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_CT0</code>{" "}
                    cookies (the extension fills these in), then restart{" "}
                    <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">npm run sync</code>.
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
                      Set <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">WHATSAPP_ENABLED=1</code>{" "}
                      (add{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">WHATSAPP_DRIVER=baileys</code>{" "}
                      for the lightweight browser-free driver), restart{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">npm run sync</code>, then scan the QR here.
                    </p>
                  )}
              </div>
            );
          })}
        </div>
      </motion.div>

      <AnimatePresence>
        {connectingTelegram && (
          <TelegramConnect onClose={() => setConnectingTelegram(false)} />
        )}
      </AnimatePresence>
    </motion.div></OverlayPortal>
  );
}
