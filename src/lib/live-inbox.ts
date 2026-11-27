"use client";

type Listener = () => void;
const listeners = new Set<Listener>();
let source: EventSource | undefined;
let connected = false;
const changed = () => listeners.forEach(listener => listener());

function subscribe(listener: Listener) {
  listeners.add(listener);
  if (!source && typeof EventSource !== "undefined") {
    source = new EventSource("/api/inbox/events");
    source.onopen = () => { connected = true; changed(); };
    source.onerror = () => { connected = false; };
    source.addEventListener("change", changed);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { source?.close(); source = undefined; connected = false; }
  };
}

/** Share one event stream across inbox/split panes. Serialize each view's
 * refreshes, retain a change received during a fetch, and fall back to polling. */
export function watchInboxChanges(refresh: () => Promise<unknown>, fallbackMs: number) {
  const doc = document, win = window;
  let stopped = false, running = false, dirty = false;
  let lastStarted = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    dirty = true;
    if (stopped || running || timer || doc.visibilityState === "hidden") return;
    timer = setTimeout(async () => {
      timer = undefined;
      if (stopped) return;
      running = true; dirty = false; lastStarted = Date.now();
      try { await refresh(); } catch { /* The view and fallback own retry UI. */ }
      finally { running = false; if (dirty && !stopped) schedule(); }
    }, Math.max(0, 150 - (Date.now() - lastStarted)));
  };
  const unsubscribe = subscribe(schedule);
  const visible = () => { if (doc.visibilityState === "visible") schedule(); };
  doc.addEventListener("visibilitychange", visible);
  win.addEventListener("focus", visible);
  // Also audit occasionally for edits by older workers or another app window.
  const poll = setInterval(() => {
    if (!connected || Date.now() - lastStarted >= 30_000) schedule();
  }, fallbackMs);
  return () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); clearInterval(poll); unsubscribe();
    doc.removeEventListener("visibilitychange", visible);
    win.removeEventListener("focus", visible);
  };
}
