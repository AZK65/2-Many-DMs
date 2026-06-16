"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
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

type Acct = {
  id: string;
  platform: string;
  label: string | null;
  status: string;
  detail: string | null;
  driver: string | null;
};

const DRIVER_LABEL: Record<string, string> = {
  baileys: "Baileys (browser-free)",
  web: "whatsapp-web.js (browser)",
  api: "cookie API (browser-free)",
  browser: "XChat (browser)",
  mtproto: "MTProto",
};

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings>(loadSettings());
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [workerRunning, setWorkerRunning] = useState<boolean | null>(null);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newFolder, setNewFolder] = useState("");

  function setTheme(t: ThemePref) {
    setThemeState(t);
    applyTheme(t);
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

  useEffect(() => {
    setThemeState(currentTheme());
    fetch("/api/tags").then((r) => r.json()).then(setTags).catch(() => {});
    fetch("/api/folders").then((r) => r.json()).then(setFolders).catch(() => {});
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts).catch(() => {});
    fetch("/api/connections")
      .then((r) => r.json())
      .then((d) => setWorkerRunning(!!d.workerRunning))
      .catch(() => setWorkerRunning(false));
  }, []);

  function update(patch: Partial<Settings>) {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
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
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-neutral-700">
          <h2 className="text-base font-semibold dark:text-neutral-100">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
          {/* Appearance */}
          <Section title="Appearance">
            <Row label="Theme" hint="Light, dark, or follow your system">
              <Segmented<ThemePref>
                value={theme}
                onChange={setTheme}
                options={[
                  ["light", "Light"],
                  ["dark", "Dark"],
                  ["system", "Auto"],
                ]}
              />
            </Row>
            <Row label="Accent · light" hint="Buttons & highlights in light mode">
              <input
                type="color"
                value={s.accentLight}
                onChange={(e) => update({ accentLight: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-neutral-700"
              />
            </Row>
            <Row label="Accent · dark" hint="Buttons & highlights in dark mode">
              <input
                type="color"
                value={s.accentDark}
                onChange={(e) => update({ accentDark: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-neutral-700"
              />
            </Row>
            <Row label="Scrollbar" hint="The thin slider on scrollable lists">
              <Segmented<ScrollbarPref>
                value={s.scrollbar}
                onChange={(v) => update({ scrollbar: v })}
                options={[
                  ["thin", "Thin"],
                  ["default", "Default"],
                  ["hidden", "Hidden"],
                ]}
              />
            </Row>
            <button
              onClick={() =>
                update({
                  accentLight: DEFAULT_SETTINGS.accentLight,
                  accentDark: DEFAULT_SETTINGS.accentDark,
                })
              }
              className="text-[11px] text-slate-400 transition hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              Reset accent to default
            </button>
          </Section>

          {/* Inbox */}
          <Section title="Inbox">
            <Row label="Default tab" hint="Which view opens on load">
              <select
                value={s.defaultView}
                onChange={(e) =>
                  update({ defaultView: e.target.value as Settings["defaultView"] })
                }
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <option value="all">All</option>
                <option value="needsreply">Needs reply</option>
                <option value="cold">Cold</option>
              </select>
            </Row>
            <Row label="Cold after" hint="Days untouched before a chat is flagged cold">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={s.coldDays}
                  onChange={(e) =>
                    update({ coldDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })
                  }
                  className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />
                <span className="text-xs text-slate-400 dark:text-neutral-500">days</span>
              </div>
            </Row>
          </Section>

          {/* Tabs (folders) */}
          <Section title="Tabs">
            {folders.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <input
                  defaultValue={f.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== f.name) renameFolder(f.id, v);
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />
                <button
                  onClick={() => delFolder(f.id)}
                  title="Delete tab"
                  className="rounded p-1 text-slate-300 transition hover:text-red-500 dark:text-neutral-600"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFolder()}
                placeholder="New tab…"
                className="min-w-0 flex-1 rounded-lg border border-dashed border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700 dark:text-neutral-200"
              />
              <button
                onClick={addFolder}
                className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg transition hover:opacity-90"
              >
                Add
              </button>
            </div>
          </Section>

          {/* Tags */}
          <Section title="Tags">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <input
                  type="color"
                  value={t.color}
                  onChange={(e) => patchTag(t.id, { color: e.target.value })}
                  className="h-7 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-neutral-700"
                />
                <input
                  defaultValue={t.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== t.name) patchTag(t.id, { name: v });
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />
                <button
                  onClick={() => delTag(t.id)}
                  title="Delete tag"
                  className="rounded p-1 text-slate-300 transition hover:text-red-500 dark:text-neutral-600"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="New tag…"
                className="min-w-0 flex-1 rounded-lg border border-dashed border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700 dark:text-neutral-200"
              />
              <button
                onClick={addTag}
                className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg transition hover:opacity-90"
              >
                Add
              </button>
            </div>
          </Section>

          {/* Board stages */}
          <Section title="Board stages">
            {s.stages.map((st, i) => (
              <div key={st.id} className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={st.color}
                  onChange={(e) => patchStage(st.id, { color: e.target.value })}
                  className="h-7 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-neutral-700"
                />
                <input
                  value={st.name}
                  onChange={(e) => patchStage(st.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />
                <button
                  onClick={() => moveStage(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  className="rounded p-1 text-slate-400 transition disabled:opacity-30 dark:text-neutral-500"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveStage(i, 1)}
                  disabled={i === s.stages.length - 1}
                  title="Move down"
                  className="rounded p-1 text-slate-400 transition disabled:opacity-30 dark:text-neutral-500"
                >
                  ↓
                </button>
                <button
                  onClick={() => delStage(st.id)}
                  title="Delete stage"
                  className="rounded p-1 text-slate-300 transition hover:text-red-500 dark:text-neutral-600"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addStage}
              className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/10 dark:border-neutral-700"
            >
              + Add stage
            </button>
          </Section>

          {/* Connections */}
          <Section title="Connections">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: workerRunning ? "#22c55e" : "#ef4444" }}
              />
              <span className="text-slate-600 dark:text-neutral-300">
                Sync worker {workerRunning == null ? "…" : workerRunning ? "running" : "not running"}
              </span>
            </div>
            {PLATFORM_ORDER.filter((p) => accounts.some((a) => a.platform === p)).map(
              (p) => (
                <div key={p} className="mb-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                    <span
                      className="grid h-4 w-4 place-items-center rounded-full text-white"
                      style={{ backgroundColor: PLATFORMS[p].bg }}
                    >
                      <PlatformGlyph platform={p as Platform} className="h-2.5 w-2.5" />
                    </span>
                    {PLATFORMS[p].label}
                  </div>
                  {accounts
                    .filter((a) => a.platform === p)
                    .map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs"
                      >
                        <span className="truncate text-slate-700 dark:text-neutral-200">
                          {a.label || PLATFORMS[p].label}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] text-slate-400 dark:text-neutral-500">
                            {a.driver ? DRIVER_LABEL[a.driver] || a.driver : "—"}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              a.status === "connected"
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                                : "bg-slate-100 text-slate-500 dark:bg-neutral-700 dark:text-neutral-300"
                            }`}
                          >
                            {a.status}
                          </span>
                        </span>
                      </div>
                    ))}
                </div>
              )
            )}
            {accounts.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-neutral-500">
                No accounts connected yet.
              </p>
            )}
          </Section>

          <p className="mt-2 text-[11px] text-slate-400 dark:text-neutral-500">
            Settings are saved on this device. Want more controls here? Tell me which.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm dark:text-neutral-100">{label}</div>
        {hint && (
          <div className="text-[11px] text-slate-400 dark:text-neutral-500">{hint}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
    <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-900">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition ${
            value === v
              ? "bg-white text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
              : "text-slate-500 dark:text-neutral-400"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
