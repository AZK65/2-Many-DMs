"use client";

import { useEffect, useState } from "react";
import { LinkIcon } from "./icons";

type AgentKey = {
  id: string;
  name: string;
  accountIds: string[];
  createdAt: string;
};
type Account = { id: string; label: string | null; platform: string };
type Access = {
  keys: AgentKey[];
  accounts: Account[];
  remoteUrl: string | null;
};
const button =
  "rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800";

export function AgentAccessSettings() {
  const [data, setData] = useState<Access | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  async function request(method = "GET", body?: unknown) {
    const response = await fetch("/api/mcp/access", {
      method,
      headers: {
        "x-tmd-agent-settings": "1",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error || "Agent access is unavailable.");
    return payload;
  }
  async function refresh() {
    setError("");
    try {
      const payload = (await request()) as Access;
      setData(payload);
      setSelected(payload.accounts.map((account) => account.id));
      setEndpoint(`${window.location.origin}/api/mcp`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load agent access.",
      );
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = (await request("POST", {
        name,
        accountIds: selected,
      })) as { key: AgentKey; token: string };
      setData((current) =>
        current
          ? { ...current, keys: [...current.keys, payload.key] }
          : current,
      );
      setToken(payload.token);
      setCreatedId(payload.key.id);
      setCreating(false);
      setName("");
      setNotice("Access key created. Copy it now; it is shown only once.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create access key.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      const payload = await request("DELETE", { id });
      setData((current) =>
        current ? { ...current, keys: payload.keys } : current,
      );
      if (id === createdId) setToken("");
      setRevokeId(null);
      setNotice("Access revoked. That key can no longer read chats.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not revoke access.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError("Clipboard unavailable. Select the value and copy it manually.");
    }
  }
  const config = JSON.stringify(
    {
      mcpServers: {
        "2manydms": {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${token || "YOUR_AGENT_KEY"}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <section
      aria-labelledby="agent-access-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-800"
    >
      <div className="flex items-start gap-3">
        <LinkIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h3
            id="agent-access-heading"
            className="text-sm font-semibold text-slate-900 dark:text-white"
          >
            Agent access{" "}
            <span className="font-normal text-slate-400 dark:text-neutral-500">
              · MCP
            </span>
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-neutral-400">
            Let your agents search chats, read history, and find text in photos.
            Each agent can read only the accounts you choose.
          </p>
        </div>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-[#1F1F1F] dark:text-neutral-400">
        Available while this computer and the app service are running, even with
        the browser closed. Agents cannot send, edit, delete, or mark messages
        as read. Your chosen agent may process the chat content it retrieves.
      </p>
      {data && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-neutral-400">
              {data.keys.length
                ? `${data.keys.length} agent${data.keys.length === 1 ? "" : "s"} with access`
                : "No agents have access"}
            </span>
            <button
              type="button"
              disabled={busy || !data.accounts.length || data.keys.length >= 32}
              onClick={() => {
                setCreating(true);
                setToken("");
                setNotice("");
              }}
              className={`${button} text-accent`}
            >
              Add agent
            </button>
          </div>
          {!data.accounts.length && (
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              Connect a messaging account first.
            </p>
          )}
          {data.keys.map((key) => (
            <div
              key={key.id}
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-neutral-800"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-slate-900 dark:text-neutral-100">
                  {key.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  Read-only · {key.accountIds.length} account
                  {key.accountIds.length === 1 ? "" : "s"}
                </p>
              </div>
              {revokeId === key.id ? (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(key.id)}
                    className={`${button} text-red-600 dark:text-red-400`}
                  >
                    Confirm revoke
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRevokeId(null)}
                    className={button}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRevokeId(key.id)}
                  aria-label={`Revoke ${key.name}`}
                  className={`${button} text-slate-500 dark:text-neutral-400`}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
          {creating && (
            <form
              className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-neutral-800"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
                Agent name
                <input
                  autoFocus
                  maxLength={60}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. My assistant"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700"
                />
              </label>
              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  Accounts this agent can read
                </legend>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {data.accounts.map((account) => (
                    <label
                      key={account.id}
                      className="flex items-start gap-2 text-sm text-slate-700 dark:text-neutral-200"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(account.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, account.id]
                              : current.filter((id) => id !== account.id),
                          )
                        }
                        className="mt-1 accent-accent focus-visible:outline-accent"
                      />
                      <span className="break-all">
                        {account.platform} · {account.label || "Account"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || !name.trim() || !selected.length}
                  className={`${button} bg-accent text-accent-fg hover:!bg-accent hover:opacity-90`}
                >
                  {busy ? "Creating…" : "Create access key"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCreating(false)}
                  className={button}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {token && (
            <div className="mt-4 space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
              <label className="block text-sm font-medium text-slate-800 dark:text-neutral-100">
                New access key
                <input
                  autoFocus
                  aria-label="New agent access key"
                  type="password"
                  readOnly
                  value={token}
                  onFocus={(event) => event.target.select()}
                  className="mt-2 w-full rounded-md border border-slate-200 bg-white p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500 dark:text-neutral-400">
                Copy before leaving. Store it in your agent’s secrets, not in a
                shared repository.
              </p>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={`${button} text-accent`}
                  onClick={() => void copy(token, "Access key")}
                >
                  Copy key
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => void copy(config, "Connection config")}
                >
                  Copy connection config
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => setToken("")}
                >
                  Done
                </button>
              </div>
            </div>
          )}
          <details className="mt-4 text-sm text-slate-600 dark:text-neutral-400">
            <summary className="cursor-pointer rounded-md py-1 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              How to connect an agent
            </summary>
            <div className="mt-3 space-y-3 text-xs leading-5">
              <p>
                For agents on this computer, choose Streamable HTTP. Use this
                local address and an Authorization header:{" "}
                <code>Bearer YOUR_AGENT_KEY</code>.
              </p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 p-2 dark:bg-neutral-900">
                  {endpoint}
                </code>
                <button
                  type="button"
                  className={button}
                  onClick={() => void copy(endpoint, "Server address")}
                >
                  Copy
                </button>
              </div>
              <div className="border-t border-slate-200 pt-3 dark:border-neutral-800">
                <p className="font-semibold text-slate-800 dark:text-neutral-100">
                  Cloud agents
                </p>
                <p className="mt-1">
                  In ChatGPT or Claude web, add the HTTPS address as a custom
                  MCP connector and choose OAuth. Approve it with an agent key
                  from this panel.
                </p>
                {data.remoteUrl ? (
                  <div className="mt-2 flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 p-2 dark:bg-neutral-900">
                      {data.remoteUrl}
                    </code>
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        void copy(data.remoteUrl!, "Cloud server address")
                      }
                    >
                      Copy HTTPS address
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-amber-700 dark:text-amber-400">
                    A cloud address has not been configured yet. Local agents
                    can connect now.
                  </p>
                )}
              </div>
              <p>
                Ask: “Find my latest conversation with Alex” or “What did we
                agree on last week?” Results include saved history and photo
                text already extracted by local OCR.
              </p>
              <p>
                Remote agents need a HTTPS address that reaches this computer.
                The local address only works on this computer. See{" "}
                <code>docs/agent-access.md</code> for remote setup and clients
                that use a local command.
              </p>
              <button
                type="button"
                className={button}
                onClick={() => void copy(config, "Connection config")}
              >
                Copy connection config{token ? "" : " template"}
              </button>
            </div>
          </details>
        </>
      )}
      {!data && !error && (
        <p
          role="status"
          className="mt-4 text-sm text-slate-500 dark:text-neutral-400"
        >
          Loading agent access…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
          {!data && (
            <button
              type="button"
              onClick={() => void refresh()}
              className={`${button} ml-2`}
            >
              Retry
            </button>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-xs text-accent">
        {notice}
      </p>
    </section>
  );
}
