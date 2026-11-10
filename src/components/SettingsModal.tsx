"use client";

import { OverlayPortal } from "./OverlayPortal";
import { UpdatePreferences } from "./UpdatePreferences";
import { AISetup } from "./AISetup";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  loadSettings,
  saveSettings,
  currentTheme,
  applyTheme,
  DEFAULT_SETTINGS,
  type Settings,
  type ScrollbarPref,
  type ThemePref,
} from "@/lib/settings";
import { PLATFORMS, PLATFORM_ORDER, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import { WhatsAppLinkCode } from "./WhatsAppLinkCode";
import { DiscordSearchConnect, DiscordConnect } from "./DiscordSearchConnect";
import { TelegramConnect } from "./TelegramConnect";
import { XConnect } from "./XConnect";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { SavedConnection } from "./ConnectSetup";
import { accountStatusView } from "@/lib/connection-status";
import {
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  FolderIcon,
  LinkIcon,
  PlusIcon,
  SunIcon,
  SparklesIcon,
  TrashIcon,
  UserIcon,
  ZapIcon,
} from "./icons";

type Acct = {
  id: string;
  platform: string;
  label: string | null;
  status: string;
  detail: string | null;
  driver: string | null;
};

type LiveAcct = {
  accountId: string;
  state: "starting" | "qr" | "ready" | "disconnected" | "disabled";
  qr?: string | null;
  detail?: string | null;
};

function accountSummary(accounts: Acct[], liveAccounts: Record<string, LiveAcct>) {
  const connected = accounts.filter((account) =>
    accountStatusView(account, liveAccounts[account.id]).connected
  ).length;
  const inactive = accounts.length - connected;
  if (!inactive) return `${connected} connected`;
  if (!connected) return `${inactive} inactive`;
  return `${connected} connected · ${inactive} inactive`;
}

const DRIVER_LABEL: Record<string, string> = {
  baileys: "Baileys (browser-free)",
  web: "whatsapp-web.js (browser)",
  api: "cookie API (browser-free)",
  browser: "XChat (browser)",
  mtproto: "MTProto",
  "personal-readonly": "Live read-only search",
  archive: "Saved archive",
};

type SettingsPage =
  | "ai"
  | "general"
  | "writing"
  | "organization"
  | "workflow"
  | "groups"
  | "integrations"
  | "connections";

const SETTINGS_PAGES: Array<{
  id: SettingsPage;
  label: string;
  description: string;
}> = [
  { id: "general", label: "General", description: "Appearance and inbox behavior" },
  { id: "writing", label: "Writing", description: "Autocorrect strength and timing" },
  { id: "organization", label: "Organization", description: "Tabs and conversation tags" },
  { id: "workflow", label: "Workflow", description: "Board stages and ordering" },
  { id: "groups", label: "Groups", description: "Macros and reusable templates" },
  { id: "integrations", label: "Integrations", description: "Scheduling" },
  { id: "connections", label: "Connections", description: "Connected messaging accounts" },
  { id: "ai", label: "AI assistant", description: "OpenRouter key and privacy" },
];

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-neutral-100 dark:placeholder:text-neutral-500";

const ICON_BUTTON_CLASS =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-500 dark:hover:bg-[#313131] dark:hover:text-neutral-100";

export function SettingsModal({ onClose, initialPage = "general" }: { onClose: () => void; initialPage?: SettingsPage }) {
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [s, setS] = useState<Settings>(loadSettings());
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [connecting, setConnecting] = useState<"telegram" | "whatsapp" | "x" | "discord" | null>(null);
  const [setupAccount, setSetupAccount] = useState<Acct | null>(null);
  const [workerRunning, setWorkerRunning] = useState<boolean | null>(null);
  const [liveAccounts, setLiveAccounts] = useState<Record<string, LiveAcct>>({});
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showApplicationTags, setShowApplicationTags] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [calApiStatus, setCalApiStatus] = useState<{ configured: boolean; managedByEnvironment: boolean } | null>(null);
  const [calApiKeyInput, setCalApiKeyInput] = useState("");
  const [calApiBusy, setCalApiBusy] = useState(false);
  const [calApiError, setCalApiError] = useState<string | null>(null);

  const [notifDenied, setNotifDenied] = useState(false);

  function setTheme(t: ThemePref) {
    setThemeState(t);
    applyTheme(t);
  }

  // Browsers only grant notification permission from a user gesture, so the
  // prompt hangs off this toggle rather than firing on page load.
  async function toggleNotifications(on: boolean) {
    if (!on) return update({ notifications: false });
    if (typeof Notification === "undefined") return;
    let perm: NotificationPermission = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    setNotifDenied(perm === "denied");
    update({ notifications: perm === "granted" });
  }

  async function connectCalApi() {
    if (!calApiKeyInput.trim() || calApiBusy) return;
    setCalApiBusy(true);
    setCalApiError(null);
    try {
      const response = await fetch("/api/calcom/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: calApiKeyInput }),
      });
      const payload = await response.json().catch(() => ({})) as { configured?: boolean; error?: string };
      if (!response.ok || !payload.configured) throw new Error(payload.error || "Cal.com could not be connected.");
      setCalApiStatus({ configured: true, managedByEnvironment: false });
      setCalApiKeyInput("");
      update({ plugins: { ...s.plugins, calcom: { ...s.plugins.calcom, enabled: true } } });
    } catch (error) {
      setCalApiError(error instanceof Error ? error.message : "Cal.com could not be connected.");
    } finally {
      setCalApiBusy(false);
    }
  }

  async function disconnectCalApi() {
    if (calApiBusy) return;
    setCalApiBusy(true);
    setCalApiError(null);
    try {
      const response = await fetch("/api/calcom/config", { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Cal.com could not be disconnected.");
      setCalApiStatus({ configured: false, managedByEnvironment: false });
    } catch (error) {
      setCalApiError(error instanceof Error ? error.message : "Cal.com could not be disconnected.");
    } finally {
      setCalApiBusy(false);
    }
  }

  // ── Tags (server) ──
  async function addTag() {
    const name = newTag.trim();
    if (!name) return;
    setNewTag("");
    const t = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    if (t?.id) setTags((x) => [...x, t]);
  }
  async function patchTag(id: string, patch: { name?: string; color?: string }) {
    setTags((x) => x.map((y) => (y.id === id ? { ...y, ...patch } : y)));
    await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }
  async function delTag(id: string) {
    setTags((x) => x.filter((y) => y.id !== id));
    await fetch(`/api/tags/${id}`, { method: "DELETE" }).catch(() => {});
  }

  // ── Folders / tabs (server) ──
  async function addFolder() {
    const name = newFolder.trim();
    if (!name) return;
    setNewFolder("");
    const f = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    if (f?.id) setFolders((x) => [...x, f]);
  }
  async function renameFolder(id: string, name: string) {
    setFolders((x) => x.map((y) => (y.id === id ? { ...y, name } : y)));
    await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }
  async function delFolder(id: string) {
    setFolders((x) => x.filter((y) => y.id !== id));
    await fetch(`/api/folders/${id}`, { method: "DELETE" }).catch(() => {});
  }

  // ── Board stages (local) ──
  function setStages(stages: Settings["stages"]) {
    update({ stages });
  }
  function addStage() {
    const id = "stage_" + Math.random().toString(36).slice(2, 7);
    setStages([...s.stages, { id, name: "New stage", color: "#94a3b8" }]);
  }
  function patchStage(id: string, patch: { name?: string; color?: string }) {
    setStages(s.stages.map((st) => (st.id === id ? { ...st, ...patch } : st)));
  }
  function delStage(id: string) {
    setStages(s.stages.filter((st) => st.id !== id));
  }
  function moveStage(i: number, dir: -1 | 1) {
    const next = [...s.stages];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next);
  }

  // ── Group macros (Cmd+G) ──
  function patchMacro(id: string, patch: Partial<Settings["macros"][number]>) {
    update({ macros: s.macros.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function delMacro(id: string) {
    update({ macros: s.macros.filter((m) => m.id !== id) });
  }
  function patchTemplate(
    id: string,
    patch: Partial<Settings["templates"][number]>
  ) {
    update({
      templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }
  function delTemplate(id: string) {
    update({ templates: s.templates.filter((t) => t.id !== id) });
  }

  useEffect(() => {
    setThemeState(currentTheme());
    fetch("/api/tags").then((r) => r.json()).then(setTags).catch(() => {});
    fetch("/api/folders").then((r) => r.json()).then(setFolders).catch(() => {});
    fetch("/api/calcom/config", { cache: "no-store" }).then((r) => r.json()).then(setCalApiStatus).catch(() => setCalApiStatus({ configured: false, managedByEnvironment: false }));
    const refreshConnections = () => {
      fetch("/api/accounts", { cache: "no-store" })
        .then((r) => r.json())
        .then(setAccounts)
        .catch(() => {});
      fetch("/api/connections", { cache: "no-store", signal: AbortSignal.timeout(5000) })
        .then((r) => { if (!r.ok) throw new Error("Status unavailable"); return r.json(); })
        .then((data) => {
          setWorkerRunning(!!data.workerRunning);
          const current = Array.isArray(data?.platforms?.accounts)
            ? (data.platforms.accounts as LiveAcct[])
            : [];
          setLiveAccounts(
            Object.fromEntries(current.map((account) => [account.accountId, account]))
          );
        })
        .catch(() => {
          setWorkerRunning(false);
          setLiveAccounts({});
        });
    };
    refreshConnections();
    const interval = window.setInterval(refreshConnections, 4000);
    return () => window.clearInterval(interval);
  }, []);

  function update(patch: Partial<Settings>) {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  }

  function updateAutocorrect(patch: Partial<Settings["autocorrect"]>) {
    update({ autocorrect: { ...s.autocorrect, ...patch } });
  }

  const activePage = SETTINGS_PAGES.find((item) => item.id === page)!;
  const connectedAccounts = accounts.filter((account) =>
    accountStatusView(account, liveAccounts[account.id]).connected
  ).length;
  const applicationTags = tags.filter((tag) => /^application\b/i.test(tag.name));
  const customTags = tags.filter((tag) => !/^application\b/i.test(tag.name));
  const normalizedTagQuery = tagQuery.trim().toLowerCase();
  const visibleCustomTags = customTags.filter((tag) =>
    tag.name.toLowerCase().includes(normalizedTagQuery)
  );
  const visibleApplicationTags = applicationTags.filter((tag) =>
    tag.name.toLowerCase().includes(normalizedTagQuery)
  );

  return (
    <OverlayPortal onClose={onClose}><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 16 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(90dvh,52rem)] sm:rounded-2xl dark:bg-[#181818]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-4 border-b border-slate-200 px-4 py-4 sm:px-6 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <h2 id="settings-title" className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
              Settings
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
              Manage how 2Many looks, organizes work, and connects to your accounts.
            </p>
          </div>
          <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 sm:flex dark:text-neutral-400">
            <CheckCircleIcon className="h-4 w-4 text-accent" />
            Saved automatically
          </div>
          <button
            type="button"
            onClick={onClose}
            className={ICON_BUTTON_CLASS}
            aria-label="Close settings"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
          <aside className="flex min-w-0 flex-col overflow-hidden border-b border-slate-200 bg-white px-3 py-3 md:border-b-0 md:border-r md:px-3 md:py-5 dark:border-neutral-800 dark:bg-[#181818]">
            <nav aria-label="Settings categories" className="grid w-full grid-cols-2 gap-1 sm:grid-cols-3 md:flex md:flex-col">
              {SETTINGS_PAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPage(item.id)}
                  aria-current={page === item.id ? "page" : undefined}
                  className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:w-full ${
                    page === item.id
                      ? "bg-slate-100 text-slate-950 dark:bg-[#272727] dark:text-white"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-[#1F1F1F] dark:hover:text-neutral-100"
                  }`}
                >
                  <SettingsPageIcon page={item.id} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    <span className="hidden truncate text-xs text-slate-400 md:block dark:text-neutral-500">
                      {item.description}
                    </span>
                  </span>
                  {item.id === "connections" && (
                    <span className="ml-auto hidden tabular-nums text-xs font-medium text-slate-400 md:block dark:text-neutral-500">
                      {connectedAccounts}/{accounts.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div className="mt-auto hidden border-t border-slate-200 px-3 pt-4 text-xs text-slate-400 md:block dark:border-neutral-800 dark:text-neutral-500">
              Preferences save on this device. AI credentials save encrypted on your server.
            </div>
          </aside>

          <main className="scroll-thin min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-slate-50 dark:bg-black">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
              <div className="mb-6">
                <h3 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  {activePage.label}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  {activePage.description}
                </p>
              </div>

              {page === "ai" && <AISetup />}
              {page === "general" && (
                <div className="space-y-5">
                  <SettingsPanel title="Appearance" description="Choose how 2Many looks on this device.">
                    <SettingsRow label="Theme" hint="Use light, dark, or your system preference.">
                      <Segmented<ThemePref>
                        value={theme}
                        onChange={setTheme}
                        options={[["light", "Light"], ["dark", "Dark"], ["system", "System"]]}
                      />
                    </SettingsRow>
                    <SettingsRow label="Light mode accent" hint="Buttons and active states in light mode.">
                      <ColorControl value={s.accentLight} onChange={(value) => update({ accentLight: value })} />
                    </SettingsRow>
                    <SettingsRow label="Dark mode accent" hint="Buttons and active states in dark mode.">
                      <ColorControl value={s.accentDark} onChange={(value) => update({ accentDark: value })} />
                    </SettingsRow>
                    <SettingsRow label="Scrollbar" hint="Control the width of scrollable lists.">
                      <Segmented<ScrollbarPref>
                        value={s.scrollbar}
                        onChange={(value) => update({ scrollbar: value })}
                        options={[["thin", "Thin"], ["default", "Default"], ["hidden", "Hidden"]]}
                      />
                    </SettingsRow>
                    <button
                      type="button"
                      onClick={() => update({ accentLight: DEFAULT_SETTINGS.accentLight, accentDark: DEFAULT_SETTINGS.accentDark })}
                      className="text-sm font-semibold text-accent transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Restore default colors
                    </button>
                  </SettingsPanel>

                  <SettingsPanel title="Updates" description="Choose when this installation receives new versions.">
                    <UpdatePreferences review onReview={onClose} />
                  </SettingsPanel>

                  <SettingsPanel title="Inbox behavior" description="Set the view and alerts you start with each day.">
                    <SettingsRow label="Default inbox" hint="The view OmniCRM opens first.">
                      <select
                        value={s.defaultView}
                        onChange={(event) => update({ defaultView: event.target.value as Settings["defaultView"] })}
                        className={`${INPUT_CLASS} w-40`}
                      >
                        <option value="all">All conversations</option>
                        <option value="needsreply">Reply</option>
                        <option value="cold">Cold</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Desktop notifications"
                      hint={notifDenied ? "Blocked in your browser. Re-enable notifications for this site." : "Notify you about new messages while OmniCRM is open."}
                    >
                      <Toggle on={s.notifications} onChange={toggleNotifications} label="Desktop notifications" />
                    </SettingsRow>
                    <SettingsRow label="Mark chats cold after" hint="Flag conversations that have had no activity.">
                      <label className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={s.coldDays}
                          onChange={(event) => update({ coldDays: Math.max(1, Math.min(90, Number(event.target.value) || 1)) })}
                          className={`${INPUT_CLASS} w-20 tabular-nums`}
                        />
                        <span className="text-sm text-slate-500 dark:text-neutral-400">days</span>
                      </label>
                    </SettingsRow>
                  </SettingsPanel>
                </div>
              )}

              {page === "writing" && (
                <div className="space-y-5">
                  <SettingsPanel title="Autocorrect" description="Choose how strongly 2manydms corrects drafts and exactly when it is allowed to act.">
                    <SettingsRow label="Local autocorrect" hint="Runs privately on this Mac. Links, emails, @handles, and #hashtags are always protected.">
                      <Toggle on={s.autocorrect.enabled} onChange={(enabled) => updateAutocorrect({ enabled })} label="Local autocorrect" />
                    </SettingsRow>
                    <SettingsRow label="Correction strength" hint={s.autocorrect.strength === "light" ? "Fixes only common, confirmed mistakes." : s.autocorrect.strength === "maximum" ? "Uses the widest safe dictionary match for the most corrections." : "Fixes common mistakes plus clear dictionary typos."}>
                      <Segmented value={s.autocorrect.strength} onChange={(strength) => updateAutocorrect({ strength })} options={[["light", "Light"], ["balanced", "Balanced"], ["maximum", "Maximum"]]} />
                    </SettingsRow>
                    <SettingsRow label="When to correct" hint="After word never changes the word you are still typing.">
                      <Segmented value={s.autocorrect.trigger} onChange={(trigger) => updateAutocorrect({ trigger })} options={[["word", "After word"], ["pause", "After pause"], ["send", "Before send"]]} />
                    </SettingsRow>
                    {s.autocorrect.trigger !== "send" && (
                      <SettingsRow label="Correction speed" hint="Lower is faster. Increase it if corrections interrupt your typing rhythm.">
                        <label className="flex min-w-56 items-center gap-3">
                          <input type="range" min={80} max={1200} step={20} value={s.autocorrect.delayMs} onChange={(event) => updateAutocorrect({ delayMs: Number(event.target.value) })} aria-label="Autocorrect delay" className="min-w-0 flex-1 accent-accent" />
                          <output className="w-16 text-right text-xs font-semibold tabular-nums text-slate-600 dark:text-neutral-300">{s.autocorrect.delayMs} ms</output>
                        </label>
                      </SettingsRow>
                    )}
                  </SettingsPanel>

                  <SettingsPanel title="Protection and feedback" description="Fine-tune what autocorrect may change and what you see while it works.">
                    <SettingsRow label="Preserve casual wording" hint="Keep shorthand and slang such as rn, lmk, pls, ecom, and dms.">
                      <Toggle on={s.autocorrect.preserveCasual} onChange={(preserveCasual) => updateAutocorrect({ preserveCasual })} label="Preserve casual wording" />
                    </SettingsRow>
                    <SettingsRow label="Fix punctuation spacing" hint="Remove accidental spaces before commas, periods, and question marks.">
                      <Toggle on={s.autocorrect.fixPunctuation} onChange={(fixPunctuation) => updateAutocorrect({ fixPunctuation })} label="Fix punctuation spacing" />
                    </SettingsRow>
                    <SettingsRow label="Spellcheck underlines" hint="Show your browser's red spelling underlines in the composer.">
                      <Toggle on={s.autocorrect.browserSpellcheck} onChange={(browserSpellcheck) => updateAutocorrect({ browserSpellcheck })} label="Spellcheck underlines" />
                    </SettingsRow>
                    <SettingsRow label="Show Undo" hint="Show a one-click way to restore the draft after an automatic correction.">
                      <Toggle on={s.autocorrect.showUndo} onChange={(showUndo) => updateAutocorrect({ showUndo })} label="Show Undo after correction" />
                    </SettingsRow>
                    <button type="button" onClick={() => update({ autocorrect: { ...DEFAULT_SETTINGS.autocorrect } })} className="text-sm font-semibold text-accent transition-colors duration-200 hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      Restore writing defaults
                    </button>
                  </SettingsPanel>
                </div>
              )}

              {page === "organization" && (
                <div className="space-y-5">
                  <SettingsPanel title="Inbox tabs" description="Create focused views for the conversations you manage.">
                    <div className="space-y-2">
                      {folders.map((folder) => (
                        <div key={folder.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-[#1F1F1F]">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-[#272727] dark:ring-neutral-700">
                            <FolderIcon className="h-4 w-4" />
                          </span>
                          <input
                            defaultValue={folder.name}
                            aria-label={`Rename ${folder.name}`}
                            onBlur={(event) => {
                              const value = event.target.value.trim();
                              if (value && value !== folder.name) renameFolder(folder.id, value);
                            }}
                            className={`${INPUT_CLASS} min-w-0 flex-1`}
                          />
                          <button type="button" onClick={() => delFolder(folder.id)} className={ICON_BUTTON_CLASS} aria-label={`Delete ${folder.name}`} title="Delete tab">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <InlineAdd value={newFolder} onChange={setNewFolder} onAdd={addFolder} placeholder="Name a new inbox tab" buttonLabel="Add tab" />
                  </SettingsPanel>

                  <SettingsPanel title="Conversation tags" description="Keep everyday labels visible and expand synced application statuses only when you need them.">
                    {!showTagManager ? (
                      <div>
                        <div className="flex flex-wrap gap-2">
                          {customTags.slice(0, 6).map((tag) => (
                            <span key={tag.id} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#272727] dark:text-neutral-200">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                              <span className="truncate">{tag.name}</span>
                            </span>
                          ))}
                          {customTags.length > 6 && (
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium tabular-nums text-slate-500 dark:bg-[#272727] dark:text-neutral-400">+{customTags.length - 6} more labels</span>
                          )}
                          {applicationTags.length > 0 && (
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium tabular-nums text-slate-500 dark:bg-[#272727] dark:text-neutral-400">{applicationTags.length} application statuses</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowTagManager(true)}
                          className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-[#272727] dark:text-neutral-200 dark:hover:bg-[#313131]"
                        >
                          Manage {tags.length} tags
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={tagQuery}
                            onChange={(event) => setTagQuery(event.target.value)}
                            placeholder="Search tags"
                            autoFocus
                            className={`${INPUT_CLASS} min-w-0 flex-1`}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setShowTagManager(false);
                              setShowApplicationTags(false);
                              setTagQuery("");
                            }}
                            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 hover:text-slate-800 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-[#272727] dark:hover:text-neutral-100"
                          >
                            Done
                          </button>
                        </div>

                        {visibleCustomTags.length > 0 && (
                          <div className="space-y-1.5">
                            {visibleCustomTags.map((tag) => (
                              <TagEditorRow key={tag.id} tag={tag} onPatch={patchTag} onDelete={delTag} />
                            ))}
                          </div>
                        )}

                        {visibleApplicationTags.length > 0 && (
                          <div className="overflow-hidden rounded-xl bg-slate-50 dark:bg-[#1F1F1F]">
                            <button
                              type="button"
                              onClick={() => setShowApplicationTags((shown) => !shown)}
                              aria-expanded={showApplicationTags || !!normalizedTagQuery}
                              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-[#272727]"
                            >
                              <span className="flex shrink-0 -space-x-1">
                                {visibleApplicationTags.slice(0, 3).map((tag) => (
                                  <span key={tag.id} className="h-5 w-5 rounded-full border-2 border-slate-50 dark:border-[#1F1F1F]" style={{ backgroundColor: tag.color }} />
                                ))}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-900 dark:text-neutral-100">Application status tags</span>
                                <span className="mt-0.5 block text-xs text-slate-400 dark:text-neutral-500">{visibleApplicationTags.length} synced statuses</span>
                              </span>
                              <span className="text-xs font-semibold text-slate-500 dark:text-neutral-400">{showApplicationTags || normalizedTagQuery ? "Hide" : "Manage"}</span>
                              <span className={`text-sm text-slate-400 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${showApplicationTags || normalizedTagQuery ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
                            </button>
                            {(showApplicationTags || !!normalizedTagQuery) && (
                              <div className="space-y-1.5 border-t border-slate-200 p-2 dark:border-neutral-800">
                                {visibleApplicationTags.map((tag) => (
                                  <TagEditorRow key={tag.id} tag={tag} onPatch={patchTag} onDelete={delTag} />
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {visibleCustomTags.length === 0 && visibleApplicationTags.length === 0 && (
                          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400 dark:bg-[#1F1F1F] dark:text-neutral-500">No tags match your search.</p>
                        )}

                        <InlineAdd value={newTag} onChange={setNewTag} onAdd={addTag} placeholder="Name a new tag" buttonLabel="Add tag" />
                      </div>
                    )}
                  </SettingsPanel>
                </div>
              )}

              {page === "workflow" && (
                <SettingsPanel title="Board stages" description="Rename, recolor, and reorder the stages used on your board.">
                  <div className="space-y-2">
                    {s.stages.map((stage, index) => (
                      <div key={stage.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-[#1F1F1F]">
                        <input
                          type="color"
                          value={stage.color}
                          onChange={(event) => patchStage(stage.id, { color: event.target.value })}
                          className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-neutral-700 dark:bg-[#272727]"
                          aria-label={`Color for ${stage.name}`}
                        />
                        <input value={stage.name} onChange={(event) => patchStage(stage.id, { name: event.target.value })} className={`${INPUT_CLASS} min-w-0 flex-1`} />
                        <div className="flex shrink-0 items-center rounded-lg bg-white ring-1 ring-slate-200 dark:bg-[#272727] dark:ring-neutral-700">
                          <button type="button" onClick={() => moveStage(index, -1)} disabled={index === 0} className={`${ICON_BUTTON_CLASS} h-8 w-8 disabled:pointer-events-none disabled:opacity-30`} aria-label={`Move ${stage.name} up`}>↑</button>
                          <button type="button" onClick={() => moveStage(index, 1)} disabled={index === s.stages.length - 1} className={`${ICON_BUTTON_CLASS} h-8 w-8 disabled:pointer-events-none disabled:opacity-30`} aria-label={`Move ${stage.name} down`}>↓</button>
                        </div>
                        <button type="button" onClick={() => delStage(stage.id)} className={ICON_BUTTON_CLASS} aria-label={`Delete ${stage.name}`} title="Delete stage">
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addStage} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm font-semibold text-accent transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent/10 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-700">
                    <PlusIcon className="h-4 w-4" /> Add board stage
                  </button>
                </SettingsPanel>
              )}

              {page === "groups" && (
                <div className="space-y-5">
                  <SettingsPanel title="Group macros" description="Saved people, group details, and an opening message for ⌘G.">
                    {s.macros.length === 0 ? (
                      <EmptyState title="No group macros yet" description="Create a group with ⌘G, then save it as a macro to manage it here." />
                    ) : (
                      <div className="space-y-3">
                        {s.macros.map((macro) => (
                          <div key={macro.id} className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-[#1F1F1F]">
                            <div className="flex items-center gap-2">
                              <input value={macro.label} onChange={(event) => patchMacro(macro.id, { label: event.target.value })} placeholder="Macro name" className={`${INPUT_CLASS} min-w-0 flex-1 font-medium`} />
                              <span className="shrink-0 text-xs text-slate-400 dark:text-neutral-500">{PLATFORMS[macro.platform as Platform]?.label} · {macro.contactIds.length} people</span>
                              <button type="button" onClick={() => delMacro(macro.id)} className={ICON_BUTTON_CLASS} aria-label={`Delete ${macro.label}`}><TrashIcon className="h-4 w-4" /></button>
                            </div>
                            <input value={macro.groupName} onChange={(event) => patchMacro(macro.id, { groupName: event.target.value })} placeholder="Group name" className={INPUT_CLASS} />
                            <textarea value={macro.message} onChange={(event) => patchMacro(macro.id, { message: event.target.value })} placeholder="Opening message" rows={3} className={`${INPUT_CLASS} resize-y`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsPanel>

                  <SettingsPanel title="Group templates" description="Reusable group names and opening messages without fixed members.">
                    {s.templates.length === 0 ? (
                      <EmptyState title="No group templates yet" description="Save a group purpose from ⌘G and it will appear here." />
                    ) : (
                      <div className="space-y-3">
                        {s.templates.map((template) => (
                          <div key={template.id} className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-[#1F1F1F]">
                            <div className="flex items-center gap-2">
                              <input value={template.label} onChange={(event) => patchTemplate(template.id, { label: event.target.value })} placeholder="Template purpose" className={`${INPUT_CLASS} min-w-0 flex-1 font-medium`} />
                              <button type="button" onClick={() => delTemplate(template.id)} className={ICON_BUTTON_CLASS} aria-label={`Delete ${template.label}`}><TrashIcon className="h-4 w-4" /></button>
                            </div>
                            <input value={template.groupName} onChange={(event) => patchTemplate(template.id, { groupName: event.target.value })} placeholder="Default group name" className={INPUT_CLASS} />
                            <textarea value={template.message} onChange={(event) => patchTemplate(template.id, { message: event.target.value })} placeholder="Opening message" rows={3} className={`${INPUT_CLASS} resize-y`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsPanel>
                </div>
              )}

              {page === "integrations" && (
                <div className="space-y-5">
                  <IntegrationPanel icon={<ClockIcon className="h-5 w-5" />} name="Cal.com" description="Create confirmed bookings and email every guest from the chat scheduler." enabled={s.plugins.calcom.enabled} onToggle={(enabled) => update({ plugins: { ...s.plugins, calcom: { ...s.plugins.calcom, enabled } } })}>
                    {s.plugins.calcom.enabled && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-[#1F1F1F]">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-neutral-200">
                            <span className={`h-2.5 w-2.5 rounded-full ${calApiStatus?.configured ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {calApiStatus == null ? "Checking API connection…" : calApiStatus.configured ? "API connected" : "API key required"}
                          </div>
                          {calApiStatus?.configured && !calApiStatus.managedByEnvironment && (
                            <button type="button" onClick={() => void disconnectCalApi()} disabled={calApiBusy} className="text-xs font-semibold text-slate-500 transition hover:text-red-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-red-300">Disconnect</button>
                          )}
                          {calApiStatus?.managedByEnvironment && <span className="text-xs text-slate-400 dark:text-neutral-500">Managed by server</span>}
                        </div>

                        {!calApiStatus?.configured && (
                          <div>
                            <label htmlFor="cal-api-key" className="mb-2 block text-sm font-medium text-slate-700 dark:text-neutral-200">API key</label>
                            <div className="flex gap-2">
                              <input id="cal-api-key" type="password" autoComplete="off" value={calApiKeyInput} onChange={(event) => { setCalApiKeyInput(event.target.value); setCalApiError(null); }} placeholder="cal_…" className={`${INPUT_CLASS} min-w-0 flex-1`} />
                              <button type="button" onClick={() => void connectCalApi()} disabled={calApiBusy || !calApiKeyInput.trim()} className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50">{calApiBusy ? "Connecting…" : "Connect"}</button>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-slate-400 dark:text-neutral-500">Stored encrypted. Find it in Cal.com → Settings → Developer → API keys.</p>
                          </div>
                        )}

                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-neutral-200">Event link</span>
                          <input value={s.plugins.calcom.link} onChange={(event) => update({ plugins: { ...s.plugins, calcom: { ...s.plugins.calcom, link: event.target.value } } })} placeholder="cal.com/you/30min" className={INPUT_CLASS} />
                          <span className="mt-2 block text-xs leading-5 text-slate-400 dark:text-neutral-500">This event type controls availability and the conferencing app. Guest emails are added from the chat scheduler.</span>
                        </label>

                        {calApiError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{calApiError}</p>}
                      </div>
                    )}
                  </IntegrationPanel>

                </div>
              )}

              {page === "connections" && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-800">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${workerRunning ? "bg-emerald-500" : "bg-red-500"}`} />
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Sync service</div>
                        <div className="text-xs text-slate-500 dark:text-neutral-400">{workerRunning == null ? "Checking status…" : workerRunning ? "Running — account status shown below" : "Not running"}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-neutral-400">{connectedAccounts} of {accounts.length} connected</span>
                      <select value="" aria-label="Connect messaging account" onChange={e => setConnecting(e.target.value as "telegram" | "whatsapp" | "x")} className={`${INPUT_CLASS} !w-auto`}>
                        <option value="" disabled>Connect account…</option>
                        <option value="telegram">Telegram</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="x">X</option>
                        <option value="discord">Discord</option>
                      </select>
                    </div>
                  </div>

                  {PLATFORM_ORDER.filter((platform) => platform === "discord" || accounts.some((account) => account.platform === platform)).map((platform) => {
                    const platformAccounts = accounts.filter((account) => account.platform === platform);
                    return (
                      <SettingsPanel
                        key={platform}
                        title={PLATFORMS[platform].label}
                        description={accountSummary(platformAccounts, liveAccounts)}
                      >
                        <div className="space-y-2">
                          {platformAccounts.map((account) => {
                            const live = liveAccounts[account.id];
                            const status = accountStatusView(account, live);
                            const statusClass =
                              status.tone === "success"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : status.tone === "progress"
                                  ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                  : "bg-slate-200 text-slate-600 dark:bg-[#272727] dark:text-neutral-300";
                            const needsWhatsAppQr = platform === "whatsapp" && (live?.state === "qr" || live?.detail === "Generating a new QR code");
                            const detail = live?.state === "qr" ? "Waiting for you to link your phone" : live?.detail || account.detail;
                            return (
                              <div key={account.id} className="rounded-xl bg-slate-50 p-3 dark:bg-[#1F1F1F]">
                                <div className="flex flex-wrap items-center gap-3">
                                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: PLATFORMS[platform].bg }}>
                                    <PlatformGlyph platform={platform as Platform} className="h-5 w-5" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">{account.label || PLATFORMS[platform].label}</div>
                                    <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-neutral-500">{account.driver ? DRIVER_LABEL[account.driver] || account.driver : "Standard connection"}{detail ? ` · ${detail}` : ""}</div>
                                  </div>
                                  {["telegram", "whatsapp", "x"].includes(platform) ? <button type="button" aria-label={`Open ${account.label || PLATFORMS[platform].label} setup`} onClick={() => setSetupAccount(account)} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${statusClass}`}>{status.label} ›</button> : <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{status.label}</span>}
                                </div>
                                {needsWhatsAppQr && (
                                  <WhatsAppLinkCode
                                    qr={live.qr}
                                    label={account.label || "WhatsApp"}
                                    accountId={account.id}
                                    canRefresh={account.driver === "web" || account.driver === "baileys"}
                                  />
                                )}
                              </div>
                            );
                          })}
                          {platform === "discord" && <div className="pt-2"><DiscordSearchConnect /></div>}
                        </div>
                      </SettingsPanel>
                    );
                  })}

                  {accounts.length === 0 && <EmptyState title="No messaging accounts" description="Choose Connect account above to set up your first inbox." />}
                </div>
              )}
            </div>
          </main>
        </div>
      </motion.div>
      <AnimatePresence>
        {setupAccount && <SavedConnection accountId={setupAccount.id} platform={setupAccount.platform as Platform} driver={setupAccount.driver} onClose={() => setSetupAccount(null)} onReconnect={() => { setConnecting(setupAccount.platform as "telegram" | "whatsapp" | "x" | "discord"); setSetupAccount(null); }} />}
        {connecting === "telegram" && <TelegramConnect onClose={() => setConnecting(null)} />}
        {connecting === "whatsapp" && <WhatsAppConnect onClose={() => setConnecting(null)} />}
        {connecting === "x" && <XConnect onClose={() => setConnecting(null)} />}
        {connecting === "discord" && <DiscordConnect onClose={() => setConnecting(null)} />}
      </AnimatePresence>
    </motion.div></OverlayPortal>
  );
}

function SettingsPageIcon({ page }: { page: SettingsPage }) {
  const className = "h-4 w-4 shrink-0";
  if (page === "ai") return <SparklesIcon className={className} />;
  if (page === "general") return <SunIcon className={className} />;
  if (page === "writing") return <SparklesIcon className={className} />;
  if (page === "organization") return <FolderIcon className={className} />;
  if (page === "workflow") return <ZapIcon className={className} />;
  if (page === "groups") return <UserIcon className={className} />;
  if (page === "integrations") return <LinkIcon className={className} />;
  return <CheckCircleIcon className={className} />;
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5 dark:bg-[#181818] dark:ring-neutral-800">
      <div className="mb-5">
        <h4 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h4>
        <p className="mt-1 text-sm text-pretty text-slate-500 dark:text-neutral-400">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 lg:flex-row lg:items-center dark:border-neutral-800">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900 dark:text-neutral-100">{label}</div>
        {hint && (
          <div className="mt-1 max-w-md text-xs leading-5 text-slate-400 dark:text-neutral-500">{hint}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 ring-1 ring-slate-200 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-slate-100 focus-within:ring-2 focus-within:ring-accent dark:bg-[#1F1F1F] dark:ring-neutral-700 dark:hover:bg-[#272727]">
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
        aria-label={`Choose color ${value}`}
      />
      <span className="text-xs font-medium tabular-nums uppercase text-slate-500 dark:text-neutral-400">{value}</span>
    </label>
  );
}

function TagEditorRow({
  tag,
  onPatch,
  onDelete,
}: {
  tag: { id: string; name: string; color: string };
  onPatch: (id: string, patch: { name?: string; color?: string }) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-[#1F1F1F]">
      <input
        type="color"
        value={tag.color}
        onChange={(event) => onPatch(tag.id, { color: event.target.value })}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-neutral-700 dark:bg-[#272727]"
        aria-label={`Color for ${tag.name}`}
      />
      <input
        defaultValue={tag.name}
        aria-label={`Rename ${tag.name}`}
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value && value !== tag.name) onPatch(tag.id, { name: value });
        }}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-[#272727] dark:text-neutral-100"
      />
      <button type="button" onClick={() => onDelete(tag.id)} className={`${ICON_BUTTON_CLASS} h-8 w-8`} aria-label={`Delete ${tag.name}`} title="Delete tag">
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function InlineAdd({
  value,
  onChange,
  onAdd,
  placeholder,
  buttonLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  buttonLabel: string;
}) {
  return (
    <form
      className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row dark:border-neutral-800"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${INPUT_CLASS} min-w-0 flex-1`} />
      <button
        type="submit"
        disabled={!value.trim()}
        className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
      >
        <PlusIcon className="h-4 w-4" />
        {buttonLabel}
      </button>
    </form>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl bg-slate-50 px-6 py-8 text-center dark:bg-[#1F1F1F]">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-[#272727] dark:ring-neutral-700">
        <PlusIcon className="h-4 w-4" />
      </span>
      <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-neutral-100">{title}</div>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400 dark:text-neutral-500">{description}</p>
    </div>
  );
}

function IntegrationPanel({
  icon,
  name,
  description,
  enabled,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5 dark:bg-[#181818] dark:ring-neutral-800">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 dark:bg-[#272727] dark:text-neutral-200">{icon}</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold text-slate-950 dark:text-white">{name}</h4>
          <p className="mt-1 max-w-xl text-sm leading-5 text-slate-500 dark:text-neutral-400">{description}</p>
        </div>
        {onToggle && <Toggle on={!!enabled} onChange={onToggle} label={name} />}
      </div>
      {children && <div className="mt-5 border-t border-slate-100 pt-5 dark:border-neutral-800">{children}</div>}
    </section>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        on ? "bg-accent" : "bg-slate-300 dark:bg-neutral-600"
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-[#1F1F1F]">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            value === v
              ? "bg-white text-slate-900 shadow-sm dark:bg-[#313131] dark:text-white"
              : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
