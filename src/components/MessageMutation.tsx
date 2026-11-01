"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ConversationDTO, MessageDTO } from "@/lib/types";
import { messageMutationPolicy, type MessageMutationAction } from "@/lib/message-mutations";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { PencilIcon, TrashIcon } from "./icons";

export function MessageMutationMenu({ conversation, message, onSelect }: {
  conversation: ConversationDTO; message: MessageDTO; onSelect: (action: MessageMutationAction) => void;
}) {
  const policy = messageMutationPolicy(conversation.platform, conversation.account?.driver, message);
  if (!policy.edit && !policy.delete) return null;
  const style = "rounded-full p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white";
  return <>
    {policy.edit && <button type="button" data-close-menu onClick={() => onSelect("edit")} title="Edit message" aria-label="Edit message" className={style}><PencilIcon className="h-4 w-4" /></button>}
    {policy.delete && <button type="button" data-close-menu onClick={() => onSelect("delete")} title="Delete for everyone" aria-label="Delete for everyone" className={style}><TrashIcon className="h-4 w-4" /></button>}
  </>;
}

/** Edits stay beside their message; the reply composer and unsent draft are untouched. */
export function MessageMutationEditor({ conversation, message, action, onClose, onSaved }: {
  conversation: ConversationDTO; message: MessageDTO; action: MessageMutationAction;
  onClose: () => void; onSaved: (message: MessageDTO) => void;
}) {
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const original = useRef(message);
  const requestId = useRef(crypto.randomUUID());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const reduced = useReducedMotion();
  const editing = action === "edit";
  const policy = messageMutationPolicy(conversation.platform, conversation.account?.driver, message);
  useEffect(() => { (editing ? textarea.current : cancel.current)?.focus(); }, [editing]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}/messages/${encodeURIComponent(message.id)}`, {
        method: editing ? "PATCH" : "DELETE", headers: { "content-type": "application/json", "x-omni-message-action": "1" },
        body: JSON.stringify({ requestId: requestId.current, expectedBody: original.current.body,
          expectedEditedAt: original.current.editedAt || null, body, confirmDelete: !editing }),
        signal: AbortSignal.timeout(35_000),
      });
      const result = await response.json();
      if (!response.ok || !result.message) throw new Error(result.error || "Could not confirm the action. Check the native app.");
      if (mounted.current) { onSaved({ ...message, ...result.message }); onClose(); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "Confirmation timed out. Check the native app; this action will not retry automatically.");
    } finally { if (mounted.current) setBusy(false); }
  }

  return <motion.form initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }}
    className="mt-2 w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm dark:border-neutral-700 dark:bg-neutral-800"
    aria-label={editing ? "Edit message" : "Confirm deletion"} onSubmit={event => { event.preventDefault(); void submit(); }}
    onKeyDown={event => {
      if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
      if (editing && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); if (body.trim() && body !== original.current.body) void submit(); }
    }}>
    <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-neutral-100">{editing ? "Edit message" : "Delete for everyone?"}</h3>
    <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-neutral-400">{editing
      ? "Recipients will see exactly this text. Edits are not automatically translated."
      : "This removes your message from the platform chat for everyone. People may already have read or saved it. This cannot be undone."}</p>
    {editing && <AutoGrowTextarea ref={textarea} value={body} onChange={event => setBody(event.target.value)} disabled={busy}
      aria-label="Edited message" maxLength={policy.maxLength} minRows={2}
      className="resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-900 outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-white" />}
    {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-600 dark:text-red-300">{error}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <button ref={cancel} type="button" onClick={onClose} disabled={busy} className="workspace-button px-3 py-1.5 text-xs disabled:opacity-50">{error ? "Close" : "Cancel"}</button>
      <button type="submit" disabled={busy || !!error || (editing && (!body.trim() || body === original.current.body))}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${editing ? "bg-slate-900 text-white hover:bg-slate-700 dark:bg-accent dark:text-neutral-950" : "bg-red-600 text-white hover:bg-red-700"}`}>
        {busy ? editing ? "Saving…" : "Deleting…" : editing ? "Save changes" : "Delete for everyone"}
      </button>
    </div>
    {busy && <p role="status" className="mt-2 text-xs text-slate-500 dark:text-neutral-400">Waiting for the platform to confirm…</p>}
  </motion.form>;
}
