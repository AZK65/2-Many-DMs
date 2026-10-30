"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { TelegramConnect } from "./TelegramConnect";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { XConnect } from "./XConnect";
import { DiscordConnect } from "./DiscordSearchConnect";
import { setupButton, setupSecondary, SetupError, useSetupConnections, SavedConnection } from "./ConnectSetup";
import { PlatformLogo } from "./PlatformLogo";
import { PLATFORMS, type Platform } from "@/lib/platforms";
import { setupAccountLabel } from "@/lib/connection-setup";
import { fetchJson } from "@/lib/fetch-json";

type Account = { id: string; platform: string; label: string | null; status: string; driver: string | null };
const channels: { platform: Platform; detail: string }[] = [
  { platform: "telegram", detail: "Create a Telegram app, then sign in with your phone and verification code." },
  { platform: "whatsapp", detail: "Open Linked devices on your phone and scan a fresh QR code." },
  { platform: "x", detail: "Sign in to the correct X account and pair the browser connector with this workspace." },
  { platform: "discord", detail: "Open the Discord sign-in flow for this workspace, then confirm your account." },
];

export function WorkspaceOnboarding() {
  const reduced = useReducedMotion();
  const [identity, setIdentity] = useState<{ id: string; name: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [channel, setChannel] = useState<Platform | null>(null);
  const [saved, setSaved] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [identityError, setIdentityError] = useState("");
  const [accountsError, setAccountsError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const { connections, error: connectionError } = useSetupConnections();
  useEffect(() => {
    const controller = new AbortController();
    setIdentityError("");
    void fetchJson<{ id: string; name: string }>("/api/workspaces/identity", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }, "Workspace").then(setIdentity).catch(cause => { if (!controller.signal.aborted) setIdentityError(cause.message); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try { const rows = await fetchJson<Account[]>("/api/accounts", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }, "Accounts"); if (!stopped) { setAccounts(rows); setAccountsError(""); } }
      catch { if (!stopped) setAccountsError("Could not check saved accounts. They have not been removed; checking again shortly."); }
      if (!stopped) timer = setTimeout(load, 4000);
    }
    void load(); return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);
  async function finish() {
    if (!identity || busy) return; setBusy(true); setError("");
    try {
      await fetchJson(`/api/workspaces/${identity.id}`, { method: "PATCH" }, "Saving setup");
      localStorage.setItem("onboarded", "1"); window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save setup. Please retry."); setBusy(false); }
  }
  const connected = accounts.filter(account => setupAccountLabel(account, connections) === "Connected").length;
  return <main className="min-h-dvh bg-slate-50 dark:bg-neutral-950">
    <WorkspaceHeader rail={false} showUtilities={false} />
    <div className="mx-auto max-w-2xl px-6 py-16"><p className="text-sm text-slate-400">Your new workspace is ready for accounts.</p></div>
    <OverlayPortal>
      <motion.div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <motion.section role="dialog" aria-modal="true" aria-labelledby="workspace-onboarding-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100" initial={{ opacity: 0, y: reduced ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }}>
          <p className="text-xs font-medium text-accent">Workspace created · Connect your accounts</p><h1 id="workspace-onboarding-title" className="mt-2 break-words text-2xl font-semibold tracking-tight">Welcome to {identity?.name || "your workspace"}</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Choose the accounts that belong here. Each login is saved only in this workspace. Nothing from your other inboxes has been imported.</p>
          <div className="my-6 space-y-3">{channels.map(({ platform, detail }) => <section key={platform} className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-800">
            <div className="flex items-center gap-3"><PlatformLogo platform={platform} /><h2 className="min-w-0 flex-1 text-sm font-semibold">{PLATFORMS[platform].label}</h2><button type="button" disabled={busy} onClick={() => setChannel(platform)} className={`${setupSecondary} shrink-0 text-accent`}>{accounts.some(account => account.platform === platform) ? "Add another" : "Connect"}</button></div>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-neutral-400">{detail}</p>
            {accounts.filter(account => account.platform === platform).map(account => <button key={account.id} type="button" onClick={() => setSaved(account)} className={`${setupSecondary} mt-3 flex w-full items-center justify-between gap-2 text-left text-xs`}><span className="truncate">{account.label || PLATFORMS[platform].label}</span><span className="shrink-0 text-accent">{account.status === "disconnected" ? "Not connected" : setupAccountLabel(account, connections)}</span></button>)}
          </section>)}</div>
          <p className="text-xs leading-5 text-slate-400">{connected ? `${connected} connected. History imports in the background; a connected account does not mean all older messages are loaded yet.` : "You can connect one account now or finish later from Settings. AI is optional and starts without an API key."}</p>
          {identityError && <SetupError>{identityError}<button type="button" onClick={() => setAttempt(value => value + 1)} className={`${setupSecondary} mt-2`}>Retry loading workspace</button></SetupError>}
          {(error || accountsError || connectionError) && <SetupError>{error || accountsError || connectionError}</SetupError>}
          <button type="button" disabled={!identity || busy} onClick={() => void finish()} className={`${setupButton} mt-6 w-full`}>{busy ? "Saving…" : connected ? "Open my workspace" : "Finish setup later"}</button>
        </motion.section>
      </motion.div>
    </OverlayPortal>
    <AnimatePresence>{channel === "telegram" && <TelegramConnect onClose={() => setChannel(null)} />}{channel === "whatsapp" && <WhatsAppConnect onClose={() => setChannel(null)} />}{channel === "x" && <XConnect onClose={() => setChannel(null)} />}{channel === "discord" && <DiscordConnect onClose={() => setChannel(null)} />}{saved && <SavedConnection accountId={saved.id} platform={saved.platform as Platform} driver={saved.driver} onClose={() => setSaved(null)} />}</AnimatePresence>
  </main>;
}
