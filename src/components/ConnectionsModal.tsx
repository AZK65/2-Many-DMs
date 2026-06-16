"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLATFORMS, PLATFORM_ORDER, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import { TelegramConnect } from "./TelegramConnect";

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
  data,
  onClose,
}: {
  data: ConnectionsData | null;
  onClose: () => void;
}) {
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null);

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
    <motion.div
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
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-neutral-700">
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
            Sync worker isn&apos;t running. Start it with{" "}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">npm run sync</code> to
            connect your accounts.
          </div>
        )}

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
                      className="rounded-lg bg-[#1FE88A] px-3 py-1.5 text-xs font-semibold text-[#04140d] transition hover:bg-[#16d579]"
                    >
                      {state === "ready" ? "Re-link" : "Connect"}
                    </button>
                  )}
                  {p === "x" && state === "disabled" && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-neutral-700 dark:text-neutral-400">
                      Not enabled
                    </span>
                  )}
                </div>

                {state === "qr" && status?.qr && (
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
                          <span className="font-semibold">XChat is locked.</span>{" "}
                          X&apos;s encrypted DMs need a one-time unlock — you&apos;ll
                          type your passcode into X&apos;s own window (we never see
                          it).
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              onClick={unlockXChat}
                              disabled={unlocking}
                              className="rounded-lg bg-[#1FE88A] px-3 py-1.5 text-xs font-semibold text-[#04140d] transition hover:bg-[#16d579] disabled:opacity-60"
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
                      Not logged in. Run{" "}
                      <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">
                        npm run x:login
                      </code>{" "}
                      (a browser opens — log in to X), then restart the worker.
                    </p>
                  )}

                {state === "disconnected" && p !== "x" && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                    Connection dropped. Restart the sync worker to reconnect.
                  </p>
                )}

                {state === "disabled" && data?.workerRunning && p === "x" && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                    Set <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">X_ENABLED=1</code>{" "}
                    in <code>.env</code>, run{" "}
                    <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">npm run x:login</code>,
                    then restart <code>npm run sync</code>.
                  </p>
                )}

                {state === "disabled" &&
                  data?.workerRunning &&
                  p === "whatsapp" && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
                      Set <code className="rounded bg-slate-100 px-1 dark:bg-neutral-700">WHATSAPP_ENABLED=1</code>{" "}
                      in <code>.env</code> and restart <code>npm run sync</code>.
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
    </motion.div>
  );
}
