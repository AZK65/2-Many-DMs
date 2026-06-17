// Client-side UI preferences, persisted in localStorage and applied via CSS
// variables / read by components. Extend freely — add a field + default, render
// a control in SettingsModal, and read it where it applies.

import { PIPELINE, type Stage } from "./pipeline";

export type ScrollbarPref = "thin" | "default" | "hidden";

export interface Settings {
  scrollbar: ScrollbarPref;
  coldDays: number; // a chat is "cold" after this many untouched days
  defaultView: "all" | "needsreply" | "cold"; // inbox tab on load
  accentLight: string; // hex — accent in light mode
  accentDark: string; // hex — accent in dark mode
  stages: Stage[]; // editable board pipeline stages
  plugins: PluginSettings;
  macros: GroupMacro[]; // saved "create group" macros (Cmd+G)
}

// A reusable "create a group" preset: members + a first message.
export interface GroupMacro {
  id: string;
  label: string;
  platform: string;
  groupName: string;
  contactIds: string[];
  message: string;
}

export interface PluginSettings {
  // Cal.com: when a chat mentions a date, offer to send your booking link with
  // the contact pre-filled as a guest.
  calcom: { enabled: boolean; link: string };
}

export const DEFAULT_SETTINGS: Settings = {
  scrollbar: "default",
  coldDays: 7,
  defaultView: "needsreply",
  accentLight: "#0e9f63",
  accentDark: "#1fe88a",
  stages: PIPELINE,
  plugins: { calcom: { enabled: false, link: "" } },
  macros: [],
};

// Build a Cal.com booking URL with the contact pre-filled as a guest.
export function calcomUrl(
  link: string,
  contact: { name?: string | null; email?: string | null }
): string {
  let base = (link || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) {
    base = base.includes("cal.com")
      ? "https://" + base.replace(/^\/+/, "")
      : "https://cal.com/" + base.replace(/^\/+/, "");
  }
  const params = new URLSearchParams();
  if (contact.name) params.set("name", contact.name);
  if (contact.email) {
    params.set("email", contact.email);
    params.set("guests", contact.email);
  }
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

// Board reads stages from here (falls back to the default pipeline).
export function loadStages(): Stage[] {
  const st = loadSettings().stages;
  return Array.isArray(st) && st.length ? st : PIPELINE;
}

const KEY = "tmd-settings";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  applySettings(s);
  window.dispatchEvent(new Event("tmd-settings")); // notify listeners (Inbox)
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "31 232 138";
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function applySettings(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const size =
    s.scrollbar === "hidden" ? "0px" : s.scrollbar === "thin" ? "4px" : "7px";
  root.style.setProperty("--scrollbar-size", size);
  root.style.setProperty("--accent-light-rgb", hexToRgb(s.accentLight));
  root.style.setProperty("--accent-dark-rgb", hexToRgb(s.accentDark));
}

// Theme lives in the existing "theme" key + the `dark` class (shared with the
// header toggle). Exposed here so Settings can offer light/dark/system too.
export type ThemePref = "light" | "dark" | "system";

export function currentTheme(): ThemePref {
  if (typeof window === "undefined") return "system";
  const t = localStorage.getItem("theme");
  return t === "light" || t === "dark" ? t : "system";
}

export function applyTheme(t: ThemePref): void {
  if (typeof window === "undefined") return;
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = t === "dark" || (t === "system" && sysDark);
  document.documentElement.classList.toggle("dark", dark);
  if (t === "system") localStorage.removeItem("theme");
  else localStorage.setItem("theme", t);
}
