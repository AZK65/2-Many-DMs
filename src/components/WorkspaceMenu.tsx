"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { OverlayPortal } from "./OverlayPortal";
import { setupButton, setupSecondary, SetupError, SetupField } from "./ConnectSetup";
import { CheckIcon, PlusIcon, CloseIcon, MoreIcon } from "./icons";
import { fetchJson } from "@/lib/fetch-json";
import { workspaceName, type WorkspaceList, type WorkspaceSummary } from "@/lib/workspace-types";

const pendingKey = "omni-workspace-create-pending";

function CreateWorkspace({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ name: string; requestId: string } | null>(null);
  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(pendingKey) || "null"); if (saved?.requestId && saved?.name) { request.current = saved; setName(saved.name); } } catch {}
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setError("");
    try {
      const clean = workspaceName(name);
      if (request.current?.name !== clean) request.current = { name: clean, requestId: crypto.randomUUID() };
      sessionStorage.setItem(pendingKey, JSON.stringify(request.current));
      setBusy(true);
      const result = await fetchJson<{ url: string }>("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.current), signal: AbortSignal.timeout(110_000) }, "Creating workspace");
      sessionStorage.removeItem(pendingKey);
      window.location.assign(result.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the workspace. Retry to continue the same setup."); setBusy(false); }
  }
  return <OverlayPortal onClose={busy ? undefined : onClose}>
    <motion.div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="workspace-create-title" onClick={event => event.stopPropagation()} initial={{ opacity: 0, y: reduced ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
        <header className="mb-6 flex items-start gap-4"><div className="flex-1"><h2 id="workspace-create-title" className="text-xl font-semibold tracking-tight">A fresh workspace</h2><p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">Separate accounts. A clean inbox. Your current workspace stays exactly where it is.</p></div><button disabled={busy} type="button" aria-label="Close workspace setup" onClick={onClose} className={setupSecondary}><CloseIcon className="h-4 w-4" /></button></header>
        <form onSubmit={create} className="space-y-6">
          <SetupField autoFocus label="Workspace name" value={name} onChange={event => setName(event.target.value)} maxLength={48} placeholder="Personal, Studio, or another business" disabled={busy} autoComplete="off" hint="You’ll see this name in the workspace menu." />
          <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-neutral-800"><p className="font-medium">Starts completely empty</p><p className="text-slate-500 dark:text-neutral-400">Accounts, chats, files, saved replies, AI keys, and settings are not copied. You’ll sign in to each platform again.</p><p className="text-xs text-slate-400">Runs locally on this computer. This is a separate workspace, not a team invitation or a new user account.</p></div>
          {error && <SetupError>{error}</SetupError>}
          {busy && <div role="status" className="space-y-2 text-sm text-slate-500 dark:text-neutral-400"><p>Preparing your private storage and sync service…</p><div className="h-2 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-neutral-800" /><p className="text-xs">Keep this window open. No existing sign-ins will be changed.</p></div>}
          <button type="submit" disabled={busy || !name.trim()} className={`${setupButton} w-full`}>{busy ? "Creating workspace…" : error ? "Retry workspace setup" : "Create and connect accounts"}</button>
        </form>
      </motion.section>
    </motion.div>
  </OverlayPortal>;
}

function RemoveWorkspace({ workspace, onClose, onRemoved }: { workspace: WorkspaceSummary; onClose: () => void; onRemoved: (path: string) => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reduced = useReducedMotion();
  async function remove(event: React.FormEvent) {
    event.preventDefault(); if (busy || confirmation !== workspace.name) return;
    setBusy(true); setError("");
    try {
      const result = await fetchJson<{ backupPath: string }>(`/api/workspaces/${workspace.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }), signal: AbortSignal.timeout(110_000) }, "Removing workspace");
      onRemoved(result.backupPath);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this workspace."); setBusy(false); }
  }
  return <OverlayPortal onClose={busy ? undefined : onClose}>
    <motion.div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="workspace-remove-title" onClick={event => event.stopPropagation()} initial={{ opacity: 0, y: reduced ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
        <h2 id="workspace-remove-title" className="text-xl font-semibold tracking-tight">Remove workspace?</h2>
        <p className="mt-3 break-words text-sm text-slate-500 dark:text-neutral-400"><strong className="font-medium text-slate-900 dark:text-neutral-100">{workspace.name}</strong> will disappear from your workspace list and stop syncing. Other workspaces stay connected.</p>
        <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">A private local backup keeps its chats, files and sign-ins for manual recovery. Nothing is deleted from Telegram, WhatsApp, X or Discord.</p>
        <form onSubmit={remove} className="mt-6 space-y-4">
          <SetupField autoFocus label="Type the workspace name to confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" maxLength={48} hint={workspace.name} />
          {error && <SetupError>{error}</SetupError>}
          {busy && <p role="status" className="text-sm text-slate-500">Stopping this workspace and saving its backup…</p>}
          <div className="flex justify-end gap-2"><button type="button" className={setupSecondary} disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || confirmation !== workspace.name} className={`${setupButton} !bg-red-600 !text-white hover:!bg-red-700`}>{busy ? "Removing…" : "Remove workspace"}</button></div>
        </form>
      </motion.section>
    </motion.div>
  </OverlayPortal>;
}

export function WorkspaceMenu({ onName }: { onName?: (name: string) => void }) {
  const [data, setData] = useState<WorkspaceList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<WorkspaceSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const callback = useRef(onName); callback.current = onName;
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetchJson<WorkspaceList>("/api/workspaces", { cache: "no-store", signal: controller.signal }, "Workspaces").then(value => {
      setData(value); callback.current?.(value.workspaces.find(row => row.id === value.currentId)?.name || "Main workspace");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [refresh]);
  async function open(id: string) {
    if (busy) return; setBusy(id); setError("");
    try {
      const result = await fetchJson<{ url: string }>(`/api/workspaces/${encodeURIComponent(id)}`, { method: "POST", signal: AbortSignal.timeout(110_000) }, "Opening workspace");
      window.location.assign(result.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open this workspace."); setBusy(null); }
  }
  async function rename(event: React.FormEvent, item: WorkspaceSummary) {
    event.preventDefault(); if (busy) return;
    setError(""); setNotice(""); setBackupPath("");
    try {
      const clean = workspaceName(name); setBusy(`rename:${item.id}`);
      await fetchJson(`/api/workspaces/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename", name: clean }) }, "Renaming workspace");
      setEditing(null); setNotice("Workspace renamed."); setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rename this workspace."); }
    finally { setBusy(null); }
  }
  return <section aria-label="Workspaces" className="border-b border-slate-100 px-2 pb-3 dark:border-neutral-800">
    <h3 className="px-3 pb-2 text-xs font-medium text-slate-400">Your workspaces</h3>
    {!data && !error && <p role="status" className="px-3 py-2 text-xs text-slate-400">Loading workspaces…</p>}
    <div className="max-h-80 space-y-1 overflow-y-auto">{data?.workspaces.map(item => <div key={item.id} className={item.id === data.currentId ? "rounded-lg bg-slate-50 dark:bg-neutral-800" : ""}><div className="flex items-center"><button type="button" disabled={!!busy} aria-current={item.id === data.currentId ? "true" : undefined} onClick={() => { if (item.id !== data.currentId || !item.setupComplete) void open(item.id); }} className={`${setupSecondary} flex min-w-0 flex-1 items-center gap-3 text-left`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-xs font-semibold text-accent">{item.name.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-slate-400">{busy === item.id ? "Opening…" : !item.setupComplete ? "Continue setup" : item.id === data.currentId ? "Current workspace" : "Open workspace"}</span></span>{item.id === data.currentId && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
    </button><button type="button" disabled={!!busy} aria-label={`Manage ${item.name}`} aria-expanded={editing === item.id} className={`${setupSecondary} shrink-0 !p-2`} onClick={() => { setEditing(editing === item.id ? null : item.id); setName(item.name); setError(""); setNotice(""); setBackupPath(""); }}><MoreIcon className="h-4 w-4" /></button></div>
      {editing === item.id && <form onSubmit={event => void rename(event, item)} className="space-y-3 px-3 pb-3 pt-2" aria-label={`Edit ${item.name}`}>
        <SetupField autoFocus label="Workspace name" value={name} onChange={event => setName(event.target.value)} disabled={!!busy} maxLength={48} autoComplete="off" />
        <div className="flex gap-2"><button type="submit" className={setupButton} disabled={!!busy || !name.trim() || name === item.name}>{busy === `rename:${item.id}` ? "Saving…" : "Save name"}</button><button type="button" className={setupSecondary} disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button></div>
        {item.id === "default" ? <p className="text-xs text-slate-400">The main workspace cannot be removed.</p> : item.id === data.currentId ? <div className="space-y-2"><p className="text-xs text-slate-500 dark:text-neutral-400">Switch to the main workspace before removing this one.</p><button type="button" className={`${setupSecondary} text-left`} disabled={!!busy} onClick={() => void open("default")}>Switch to main workspace</button></div> : <button type="button" className={`${setupSecondary} !text-red-600 dark:!text-red-400`} disabled={!!busy} onClick={() => setRemoving(item)}>Remove workspace…</button>}
      </form>}
    </div>)}</div>
    {notice && <div role="status" className="p-3 text-xs text-slate-500 dark:text-neutral-400"><p>{notice}</p>{backupPath && <details className="mt-2"><summary className="cursor-pointer rounded focus-visible:outline-accent">Local backup location</summary><p className="mt-2 break-all select-all">{backupPath}</p><p className="mt-2">Keep this folder private. It contains saved sign-ins. Recovery is manual.</p></details>}</div>}
    {error && <div role="alert" className="p-3 text-xs text-red-600 dark:text-red-400">{error}<button type="button" className={`${setupSecondary} mt-2`} onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    <button type="button" disabled={!!busy} onClick={() => setCreating(true)} className={`${setupSecondary} mt-2 flex w-full items-center gap-3 text-left`}><PlusIcon className="h-4 w-4 text-accent" /><span>Add new workspace</span></button>
    <AnimatePresence>{creating && <CreateWorkspace onClose={() => { setCreating(false); setRefresh(value => value + 1); }} />}</AnimatePresence>
    <AnimatePresence>{removing && <RemoveWorkspace workspace={removing} onClose={() => setRemoving(null)} onRemoved={path => { setRemoving(null); setEditing(null); setNotice("Workspace removed. Its local backup is saved."); setBackupPath(path); setRefresh(value => value + 1); }} />}</AnimatePresence>
  </section>;
}
