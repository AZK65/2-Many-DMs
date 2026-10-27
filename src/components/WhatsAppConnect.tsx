"use client";
import { useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import type { SetupAccount } from "@/lib/connection-setup";
import { ConnectShell, ConnectionProgress, SetupError, setupButton, useSetupConnections } from "./ConnectSetup";
import { WhatsAppLinkCode } from "./WhatsAppLinkCode";

export function WhatsAppConnect({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [account, setAccount] = useState<SetupAccount | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const inFlight = useRef(false);
  const { connections, error: statusError } = useSetupConnections();
  const live = connections?.platforms.accounts?.find(a => a.accountId === account?.id);
  const ready = connections?.workerRunning && live?.state === "ready";
  async function prepare() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try {
      const saved = await fetchJson<SetupAccount>("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "whatsapp", reusePending: true }), signal: AbortSignal.timeout(12_000) }, "WhatsApp setup");
      setAccount(saved);
    } catch (cause) { setError((cause as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <ConnectShell platform="whatsapp" subtitle="Link as a companion device. Keep using your phone." steps={["Prepare", "Scan QR", "Sync"]} current={ready ? 2 : account ? 1 : 0} busy={busy} onClose={onClose}>
    {!account ? <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-neutral-800"><h3 className="font-semibold">Have your phone nearby</h3><p className="mt-2 text-slate-500 dark:text-neutral-400">Open WhatsApp on your phone and keep it online. This adds a linked device; it does not move or delete your chats.</p><p className="mt-3 text-slate-500 dark:text-neutral-400">Use this setup on a second screen so you can scan the QR code with your phone.</p></div>
      <button className={`${setupButton} w-full`} onClick={prepare} disabled={busy}>{busy ? "Preparing your connection…" : "Show my QR code"}</button>
    </div> : <>
      {!ready && live?.state === "qr" && <WhatsAppLinkCode qr={live.qr} label={account.label || "WhatsApp"} accountId={account.id} canRefresh={account.driver === "web" || account.driver === "baileys"} />}
      {live?.state !== "qr" && <ConnectionProgress accountId={account.id} platform="whatsapp" onReady={onConnected} />}
      {!ready && <details className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-neutral-800"><summary className="cursor-pointer font-medium focus-visible:outline-accent">Having trouble linking?</summary><ul className="mt-3 list-inside list-disc space-y-2 text-slate-500 dark:text-neutral-400"><li>Scan from WhatsApp’s Linked devices screen, not your camera.</li><li>If your device limit is full, remove a device you no longer use on your phone.</li><li>Keep this screen open. Codes rotate automatically while linking.</li><li>If WhatsApp logs this device out, you will need to link again. Never reset your phone account to fix a QR code.</li></ul></details>}
      <button className={`${setupButton} mt-6 w-full`} onClick={onClose}>{ready ? "Done" : "Finish later"}</button>
    </>}
    {(error || statusError) && <SetupError>{error || statusError}</SetupError>}
  </ConnectShell>;
}
