"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function InvitePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/share/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not sign in.");
      setLoading(false);
      return;
    }
    router.replace("/shared");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 dark:bg-neutral-950">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-lg text-white dark:bg-white dark:text-neutral-950">2</div>
          <div>
            <h1 className="font-semibold text-slate-950 dark:text-white">View 2 Many DMs</h1>
            <p className="text-sm text-slate-500 dark:text-neutral-400">Live, read-only CRM access</p>
          </div>
        </div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-neutral-300">Invite code</label>
        <input
          autoFocus
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter your invite code"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <button
          disabled={loading || !code.trim()}
          className="mt-4 w-full rounded-xl bg-slate-950 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950"
        >
          {loading ? "Checking…" : "Open CRM"}
        </button>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">You can inspect conversations, folders, tags and profiles. Editing and sending are disabled.</p>
      </form>
    </main>
  );
}
