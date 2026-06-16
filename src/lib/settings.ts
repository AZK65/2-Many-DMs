// Client-side UI preferences, persisted in localStorage and applied via CSS
// variables / read by components. Extend freely — add a field + default, render
// a control in SettingsModal, and read it where it applies.

export type ScrollbarPref = "thin" | "default" | "hidden";

export interface Settings {
  scrollbar: ScrollbarPref;
  coldDays: number; // a chat is "cold" after this many untouched days
  defaultView: "all" | "needsreply" | "cold"; // inbox tab on load
}

export const DEFAULT_SETTINGS: Settings = {
  scrollbar: "default",
  coldDays: 7,
  defaultView: "needsreply",
};

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

export function applySettings(s: Settings): void {
  if (typeof document === "undefined") return;
  const size =
    s.scrollbar === "hidden" ? "0px" : s.scrollbar === "thin" ? "4px" : "7px";
  document.documentElement.style.setProperty("--scrollbar-size", size);
}
