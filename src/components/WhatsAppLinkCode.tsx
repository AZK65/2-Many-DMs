"use client";

import { useEffect, useRef, useState } from "react";

export function WhatsAppLinkCode({ qr, label, accountId, canRefresh = false }: {
  qr?: string | null;
  label: string;
  accountId?: string;
  canRefresh?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejectedQr, setRejectedQr] = useState<string | null>(null);
  const [freshQr, setFreshQr] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const requesting = useRef(false);
  const shownQr = freshQr || (qr !== rejectedQr ? qr : null);

  useEffect(() => { setFreshQr(null); }, [qr]);
  useEffect(() => { setImageFailed(false); }, [shownQr]);

  async function refresh() {
    if (!accountId || requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setError("");
    setRejectedQr(qr || null);
    setFreshQr(null);
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/qr`, {
        method: "POST",
        signal: AbortSignal.timeout(125_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate a new QR code.");
      setFreshQr(data.status?.qr || null);
      setLinked(data.status?.state === "ready" || data.status?.state === "starting");
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The request timed out. Check the connection and try again.");
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-4 border-t border-slate-200 pt-4 dark:border-neutral-700" aria-busy={busy}>
      {!busy && !linked && shownQr && !imageFailed ? (
        // White quiet zone and a square image keep the code scannable in both themes.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shownQr} alt={`Scan to connect ${label}`} width={320} height={320}
          onError={() => setImageFailed(true)} className="aspect-square h-auto w-full max-w-80 rounded-lg bg-white p-3" />
      ) : (
        <p role="status" className="py-8 text-center text-sm text-slate-500 dark:text-neutral-400">
          {linked ? "Phone linked. Finishing the connection…" : busy ? "Generating a new QR code…" : imageFailed ? "Could not display this code. Generate a new one below." : "Waiting for a fresh QR code…"}
        </p>
      )}
      <div className="max-w-sm text-center">
        <p className="text-sm text-slate-700 dark:text-neutral-200">
          On your phone, open WhatsApp → <b>Settings</b> → <b>Linked Devices</b> → <b>Link a Device</b>, then scan this code.
        </p>
        <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Keep this screen open. Codes update automatically until your phone is linked.</p>
      </div>
      {accountId && canRefresh && !linked && (
        <button type="button" onClick={refresh} disabled={busy}
          className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-300 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50 dark:bg-[#313131] dark:text-neutral-100 dark:hover:bg-neutral-700">
          {busy ? "Generating new code…" : "Generate new QR code"}
        </button>
      )}
      {error && <p role="alert" className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
