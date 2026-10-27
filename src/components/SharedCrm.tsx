"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import type { Platform } from "@/lib/platforms";
import type { TagDTO } from "@/lib/types";

type SharedContact = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage: string | null;
  platform: Platform;
  lastActivityAt: string | null;
  tags: TagDTO[];
};

function stageName(value: string | null) {
  if (!value) return "No stage";
  return value.replace(/^stage_/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SharedCrm() {
  const [contacts, setContacts] = useState<SharedContact[]>([]);
  const [selected, setSelected] = useState<SharedContact | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/share/contacts")
        .then((r) => r.json())
        .then((data: SharedContact[]) => {
          if (!alive) return;
          setContacts(data);
          setSelected((current) =>
            current ? data.find((c) => c.id === current.id) || null : null
          );
          setUpdatedAt(new Date());
          setLoading(false);
        })
        .catch(() => setLoading(false));
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.handle, c.company, c.email, c.phone, c.notes, ...c.tags.map((t) => t.name)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [contacts, query]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-sm font-bold text-white dark:bg-white dark:text-neutral-950">2</div>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold">CRM people</h1>
            <p className="text-xs text-slate-400">Live read-only view · updates automatically</p>
          </div>
          <span className="hidden text-xs text-slate-400 sm:block">
            {contacts.length} people{updatedAt ? ` · synced ${updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-5 flex items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, companies, tags or notes…"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-slate-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus:border-neutral-600"
          />
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-slate-400">Loading CRM…</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((contact) => (
              <motion.button
                key={contact.id}
                layout
                onClick={() => setSelected(contact)}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={contact.name} platform={contact.platform} src={contact.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{contact.name}</div>
                    <div className="truncate text-sm text-slate-400">{contact.company || contact.handle}</div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">{stageName(contact.stage)}</span>
                </div>
                {contact.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {contact.tags.slice(0, 4).map((tag) => (
                      <span key={tag.id} className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: tag.color, backgroundColor: `${tag.color}18` }}>{tag.name}</span>
                    ))}
                  </div>
                )}
                <p className="mt-3 line-clamp-3 min-h-10 whitespace-pre-wrap text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                  {contact.notes || "No notes yet"}
                </p>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setSelected(null)}>
            <motion.section
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900"
            >
              <div className="flex items-start gap-4">
                <Avatar name={selected.name} platform={selected.platform} src={selected.avatarUrl} size="lg" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="text-sm text-slate-400">{selected.handle}</p>
                </div>
                <button onClick={() => setSelected(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800">✕</button>
              </div>
              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Company" value={selected.company} />
                <Detail label="Stage" value={stageName(selected.stage)} />
                <Detail label="Email" value={selected.email} />
                <Detail label="Phone" value={selected.phone} />
              </div>
              <div className="mt-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.tags.length ? selected.tags.map((tag) => <span key={tag.id} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ color: tag.color, backgroundColor: `${tag.color}18` }}>{tag.name}</span>) : <span className="text-sm text-slate-400">No tags</span>}
                </div>
              </div>
              <div className="mt-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notes</div>
                <div className="min-h-24 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">{selected.notes || "No notes yet."}</div>
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return <div className="rounded-xl bg-slate-50 p-3 dark:bg-neutral-800"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 break-words text-slate-700 dark:text-neutral-200">{value || "—"}</div></div>;
}
