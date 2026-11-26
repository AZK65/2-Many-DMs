"use client";
import { useEffect, useState } from "react";

export default function AuthorizeAgent() {
  const [details, setDetails] = useState<{
    clientName: string;
    redirectOrigin: string;
  } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<Record<string, string>>({});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequest(Object.fromEntries(params));
    fetch(`/api/mcp/oauth/authorize?${params}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error_description ||
              "This connection request is invalid or expired.",
          );
        setDetails(payload);
      })
      .catch((cause) => setError(cause.message));
  }, []);
  async function approve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/oauth/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tmd-oauth-consent": "1",
        },
        body: JSON.stringify({ request, key: key.trim() }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error_description || "Could not authorize this agent.",
        );
      setKey("");
      window.location.assign(payload.redirect);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not authorize this agent.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 text-slate-900 dark:bg-[#111] dark:text-neutral-100">
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-800">
        <p className="mb-3 text-sm font-semibold text-accent">
          2ManyDMs · Agent access
        </p>
        <h1 className="text-2xl font-semibold">Connect your cloud agent</h1>
        {details ? (
          <>
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-neutral-400">
              <strong className="text-slate-900 dark:text-white">
                {details.clientName}
              </strong>{" "}
              is requesting read-only access to your saved chats. Continue only
              if you started this connection.
            </p>
            <p className="mt-2 break-all text-xs text-slate-500 dark:text-neutral-400">
              Returns to {details.redirectOrigin}
            </p>
            <ol className="my-5 list-inside list-decimal space-y-2 text-sm leading-6 text-slate-600 dark:text-neutral-400">
              <li>
                On your computer, open Settings → Integrations → Agent access.
              </li>
              <li>
                Create a key for this agent and choose the accounts it may read.
              </li>
              <li>Paste that key below to approve this connection.</li>
            </ol>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void approve();
              }}
            >
              <label className="block text-sm font-medium">
                Agent access key
                <input
                  autoFocus
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  maxLength={100}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700"
                />
              </label>
              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                The agent can search and read only the accounts on this key. It
                cannot send, delete, edit, or mark messages read. Retrieved
                chats are shared with the agent. Revoke the key in Settings to
                disconnect it.
              </p>
              <button
                type="submit"
                disabled={busy || !key.trim()}
                className="mt-5 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg transition hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Authorize read-only access"}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500 dark:text-neutral-400">
              To cancel, close this window. No access is granted until you
              authorize.
            </p>
          </>
        ) : (
          !error && (
            <p role="status" className="mt-4 text-sm">
              Checking connection request…
            </p>
          )
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
