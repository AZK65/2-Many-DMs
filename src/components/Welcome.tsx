"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  PLATFORMS,
  PLATFORM_ORDER,
  type Platform,
} from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import ThemeToggle from "./ThemeToggle";
import { TelegramConnect } from "./TelegramConnect";
import { ConnectionsModal, type ConnectionsData } from "./ConnectionsModal";
import { TG_LINK } from "@/lib/links";

import {
  CheckCircleIcon,
  CheckIcon,
  ExternalLinkIcon,
  MailIcon,
  ZapIcon,
} from "./icons";

type AccountRow = {
  id: string;
  platform: string;
  label: string | null;
  status: string;
};

const SETUP_STEPS = [
  { title: "Welcome", detail: "See the daily workflow" },
  { title: "Channels", detail: "Connect your inboxes" },
  { title: "Ready", detail: "Start with a clean queue" },
];

export function Welcome() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [showTelegram, setShowTelegram] = useState(false);
  const [connections, setConnections] = useState<ConnectionsData | null>(null);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [xStage, setXStage] = useState<"closed" | "warning" | "steps">("closed");
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/accounts")
        .then((r) => r.json())
        .then(setAccounts)
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const anyConnected = accounts.some((a) => a.status === "connected");
  const accountsFor = (p: string) => accounts.filter((a) => a.platform === p);

  // Re-trigger the connect flow for one more account of this platform.
  function addAnother(p: string) {
    if (p === "telegram") return setShowTelegram(true);
    if (p === "x") {
      setXStage("warning");
      if (!pairCode) getPairCode();
      return;
    }
    // WhatsApp: create a pending account; it links via QR (scan in Connections
    // once the worker runs it).
    fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: p }),
    }).catch(() => {});
  }
  function removeAccount(id: string) {
    fetch(`/api/accounts/${id}`, { method: "DELETE" }).catch(() => {});
    setAccounts((a) => a.filter((x) => x.id !== id));
  }

  function go(next: number) {
    setStep(next);
  }

  async function getPairCode() {
    const res = await fetch("/api/accounts/pair", { method: "POST" });
    const d = await res.json();
    setPairCode(d.code);
  }

  function openWhatsApp() {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((d: ConnectionsData) => {
        setConnections(d);
        setShowWhatsApp(true);
      })
      .catch(() => setShowWhatsApp(true));
  }

  function finish() {
    try {
      localStorage.setItem("onboarded", "1");
    } catch {}
    router.replace("/");
  }

  return (
    <div className="relative min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(32rem,1.15fr)] dark:bg-black">
      <aside className="hidden min-h-dvh flex-col border-r border-slate-200 bg-white px-12 py-10 lg:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lockup-light.png" alt="2 Many DMs" className="h-9 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lockup-dark.png" alt="2 Many DMs" className="hidden h-9 w-auto dark:block" />
        </div>
        <div className="mt-16 max-w-md">
          <p className="text-sm font-semibold text-accent">Your daily command center</p>
          <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight text-slate-950 dark:text-white">
            All your conversations. One place to keep up.
          </h1>
          <p className="mt-4 max-w-sm text-pretty text-base text-slate-500 dark:text-neutral-400">
            Connect your inboxes, find any conversation, and keep your follow-ups in one place.
          </p>
        </div>
        <nav aria-label="Onboarding progress" className="mt-12 space-y-2">
          {SETUP_STEPS.map((item, index) => (
            <div
              key={item.title}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                index === step
                  ? "bg-slate-100 dark:bg-neutral-800"
                  : "text-slate-400 dark:text-neutral-500"
              }`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold tabular-nums ${
                index < step
                  ? "bg-accent text-accent-fg"
                  : index === step
                    ? "bg-slate-950 text-white dark:bg-white dark:text-black"
                    : "bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500"
              }`}>
                {index < step ? <CheckIcon className="h-4 w-4" /> : index + 1}
              </span>
              <div>
                <div className={`text-sm font-semibold ${index === step ? "text-slate-900 dark:text-white" : ""}`}>
                  {item.title}
                </div>
                <div className="text-xs">{item.detail}</div>
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 text-xs text-slate-400 dark:text-neutral-500">
          <CheckCircleIcon className="h-4 w-4 text-accent" />
          Credentials stay in their platform sessions.
        </div>
      </aside>

      <main className="relative flex min-h-dvh items-center justify-center px-6 py-16 lg:px-12">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="absolute left-6 top-6 flex items-center gap-2 lg:hidden">
          {SETUP_STEPS.map((item, index) => (
            <span
              key={item.title}
              aria-label={item.title}
              className={`h-2 rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                index === step ? "w-8 bg-accent" : index < step ? "w-2 bg-accent" : "w-2 bg-slate-300 dark:bg-neutral-700"
              }`}
            />
          ))}
        </div>

      <div className="w-full max-w-xl">
        <div>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* ── Step 0: intro ── */}
            {step === 0 && (
              <div>
                <div className="mb-10 flex lg:hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/lockup-light.png" alt="2 Many DMs" className="h-9 w-auto dark:hidden" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/lockup-dark.png" alt="2 Many DMs" className="hidden h-9 w-auto dark:block" />
                </div>
                <div className="mb-8 flex items-center gap-3">
                  {PLATFORM_ORDER.filter((p) => p !== "discord" && p !== "gmail").map((p, i) => (
                    <motion.span
                      key={p}
                      initial={{ scale: 0, y: 10 }}
                      animate={{ scale: 1, y: [0, -8, 0] }}
                      transition={{
                        scale: {
                          delay: 0.15 + i * 0.12,
                          type: "spring",
                          stiffness: 300,
                        },
                        y: {
                          delay: 0.4 + i * 0.2,
                          duration: 2.4,
                          repeat: Infinity,
                          ease: "easeInOut",
                        },
                      }}
                      className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg"
                      style={{ backgroundColor: PLATFORMS[p].bg }}
                    >
                      <PlatformGlyph platform={p} className="h-7 w-7" />
                    </motion.span>
                  ))}

                </div>
                <motion.h1
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="max-w-lg text-balance text-4xl font-bold tracking-tight text-slate-950 dark:text-white"
                >
                  Less switching. More conversation.
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.62 }}
                  className="mt-4 max-w-lg text-pretty text-base text-slate-500 dark:text-neutral-400"
                >
                  Bring Telegram, WhatsApp, X, Discord and Gmail into one working queue. Search your history, save drafts, and keep track of the conversations that need you.
                </motion.p>
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.74 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => go(1)}
                  className="mt-8 w-full rounded-xl bg-accent px-3 py-3 text-base font-semibold text-accent-fg transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-black"
                >
                  Set up my workspace
                </motion.button>
                <button
                  onClick={finish}
                  className="mt-2 text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                >
                  Skip for now
                </button>
              </div>
            )}

            {/* ── Step 1: connect ── */}
            {step === 1 && (
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-neutral-100">
                  Connect your channels
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  Connect at least one — you can add the rest later.
                </p>

                <div className="mt-6 space-y-3">
                  {(
                    [
                      ["telegram", "Telegram", "Sign in with your phone number", () => setShowTelegram(true)],
                      ["whatsapp", "WhatsApp", "Scan a QR code with your phone", openWhatsApp],
                      [
                        "x",
                        "X (Twitter)",
                        "Link your session with our extension",
                        () => setXStage((s) => (s === "closed" ? "warning" : "closed")),
                      ],
                    ] as [Platform, string, string, () => void][]
                  ).map(([p, title, desc, onConnect], i) => (
                    <motion.div
                      key={p}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.08 }}
                    >
                      <ConnectCard
                        platform={p}
                        title={title}
                        desc={desc}
                        accounts={accountsFor(p)}
                        onConnect={onConnect}
                        onAdd={() => addAnother(p)}
                        onRemove={removeAccount}
                      />
                    </motion.div>
                  ))}

                  {/* X warning + steps */}
                  <AnimatePresence>
                    {xStage !== "closed" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        {xStage === "warning" ? (
                          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                            <div className="flex items-start gap-2.5">
                              <span className="text-lg leading-none">⚠️</span>
                              <div>
                                <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                                  Heads up before you connect X
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-200/90">
                                  <b>Don’t use a datacenter proxy with X.</b> We
                                  strongly recommend running this on your{" "}
                                  <b>local machine</b>, or using a{" "}
                                  <b>5G / mobile proxy</b>. Otherwise there’s a
                                  much higher risk of your account getting
                                  <b> banned</b>.
                                </p>
                                <button
                                  onClick={() => {
                                    setXStage("steps");
                                    if (!pairCode) getPairCode();
                                  }}
                                  className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                                >
                                  I understand — show me how
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                            <ol className="space-y-2 text-slate-600 dark:text-neutral-300">
                              <li>
                                <b>1.</b> Install the <b>OmniCRM</b> Chrome
                                extension (load the{" "}
                                <code className="rounded bg-slate-100 px-1 dark:bg-neutral-800">extension</code>{" "}
                                folder unpacked at{" "}
                                <code className="rounded bg-slate-100 px-1 dark:bg-neutral-800">chrome://extensions</code>).
                              </li>
                              <li>
                                <b>2.</b> Make sure you’re logged into{" "}
                                <b>x.com</b> in this browser.
                              </li>
                              <li>
                                <b>3.</b> Open the extension, paste this code,
                                and hit Connect:
                              </li>
                            </ol>
                            <button
                              onClick={() => {
                                if (pairCode) {
                                  navigator.clipboard?.writeText(pairCode).catch(() => {});
                                  setCopied(true);
                                  setTimeout(() => setCopied(false), 1500);
                                }
                              }}
                              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-3 font-mono text-xl font-bold tracking-[0.3em] text-white transition hover:bg-slate-800 dark:bg-neutral-100 dark:text-neutral-900"
                            >
                              {pairCode ?? "…"}
                              <span className="font-sans text-[11px] font-medium tracking-normal opacity-60">
                                {copied ? "copied!" : "tap to copy"}
                              </span>
                            </button>
                            <p className="mt-2 text-[11px] text-slate-400 dark:text-neutral-500">
                              This updates automatically once X links.
                            </p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* CTA — custom integrations */}
                  <a
                    href={TG_LINK}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 p-3.5 transition hover:border-accent/50 hover:bg-accent/40 dark:border-neutral-700 dark:hover:border-accent/40 dark:hover:bg-accent/5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 dark:text-neutral-100">
                        Need a custom integration?
                      </div>
                      <div className="text-xs text-slate-500 dark:text-neutral-400">
                        Don’t see a platform, or want something tailored? The
                        developer can build it for you.
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg">
                      Contact
                      <span className="rounded bg-white/20 px-1 text-[10px]">
                        Paid
                      </span>
                    </span>
                  </a>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <button
                    onClick={() => go(0)}
                    className="text-sm font-medium text-slate-400 transition hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                  >
                    ← Back
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => go(2)}
                    className="rounded-xl bg-accent px-3 py-2 text-base font-semibold text-accent-fg transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {anyConnected ? "Continue" : "Connect later"}
                  </motion.button>
                </div>
              </div>
            )}

            {/* ── Step 2: done ── */}
            {step === 2 && (
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl dark:bg-emerald-500/15"
                >
                  ✓
                </motion.div>
                <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 dark:text-neutral-100">
                  You’re all set
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-neutral-400">
                  Here’s what you can do now:
                </p>
                <div className="mt-6 space-y-2.5 text-left">
                  {[
                    { icon: <MailIcon className="h-5 w-5" />, title: "Unified inbox", desc: "Triage every DM by who owes a reply." },
                    { icon: <ZapIcon className="h-5 w-5" />, title: "Search your history", desc: "Find messages, shared files, and the people you know." },
                    { icon: <CheckCircleIcon className="h-5 w-5" />, title: "Follow-ups", desc: "Keep reminders and your next steps beside your conversations." },
                  ].map(({ icon, title, desc }, i) => (
                    <motion.div
                      key={title}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + i * 0.1 }}
                      className="flex items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-neutral-900 dark:ring-neutral-800"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-neutral-200">{icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                          {title}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-neutral-400">
                          {desc}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={finish}
                  className="mt-7 w-full rounded-xl bg-accent px-3 py-3 text-base font-semibold text-accent-fg transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Open my inbox
                </motion.button>
              </div>
            )}
          </motion.div>
        </div>
      </div>
      </main>

      <AnimatePresence>
        {showTelegram && (
          <TelegramConnect onClose={() => setShowTelegram(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showWhatsApp && (
          <ConnectionsModal
            data={connections}
            onClose={() => setShowWhatsApp(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ConnectCard({
  platform,
  title,
  desc,
  accounts,
  onConnect,
  onAdd,
  onRemove,
}: {
  platform: Platform;
  title: string;
  desc: string;
  accounts: { id: string; label: string | null }[];
  onConnect: () => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const has = accounts.length > 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundColor: PLATFORMS[platform].bg }}
        >
          <PlatformGlyph platform={platform} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900 dark:text-neutral-100">
            {title}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-neutral-400">
            {desc}
          </div>
        </div>
        {has ? (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
          >
            {accounts.length} connected ✓
          </motion.span>
        ) : (
          <button
            onClick={onConnect}
            className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg transition hover:bg-accent"
          >
            Connect
          </button>
        )}
      </div>

      {has && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-neutral-800">
          {accounts.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <span className="max-w-[10rem] truncate">{a.label || title}</span>
              <button
                onClick={() => onRemove(a.id)}
                title="Remove account"
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-slate-400 transition hover:bg-slate-200 hover:text-red-500 dark:text-neutral-500 dark:hover:bg-neutral-700"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            onClick={onAdd}
            className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-accent transition hover:border-accent/60 hover:bg-accent/10 dark:border-neutral-700 dark:text-accent"
          >
            + Add
          </button>
        </div>
      )}
    </div>
  );
}
