"use client";

import { useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DemoInbox } from "./DemoInbox";
import { people, DemoAvatar } from "./DemoPeople";
import { MailIcon, SheetIcon, ZapIcon, SparklesIcon, CheckIcon } from "../icons";


export type DemoView = "inbox" | "board" | "flow" | "assistant";
const views = [{ id: "inbox", label: "Inbox", icon: MailIcon }, { id: "board", label: "CRM", icon: SheetIcon }, { id: "flow", label: "Flows", icon: ZapIcon }, { id: "assistant", label: "Ask AI", icon: SparklesIcon }] as const;
// Fictional content only. This component never calls an account API or AI service.
export function ProductDemo({ view, onView }: { view: DemoView; onView: (view: DemoView) => void }) {
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState(0);
  const [mobileThread, setMobileThread] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<Record<number, string[]>>({});
  const [stage, setStage] = useState([0, 1, 2, 0]);
  const [flowRun, setFlowRun] = useState(false);
  const [answer, setAnswer] = useState(false);
  function openChat(index: number) { setSelected(index); setDraft(""); setQuery(""); setMobileThread(true); onView("inbox"); }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + views.length - 1) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault(); onView(views[next].id); document.getElementById(`demo-tab-${views[next].id}`)?.focus();
  }
  return <div data-demo-frame className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-2xl shadow-slate-900/10 dark:border-neutral-700 dark:bg-[#181818] dark:shadow-black/40">
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-neutral-700/50 dark:bg-[#1F1F1F]">
      <span className="flex min-w-0 items-center gap-3 text-xs"><span className="font-semibold">2ManyDMs</span><span className="hidden text-slate-400 sm:inline">/</span><span className="hidden text-slate-400 sm:inline">Personal workspace</span></span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 rounded-full bg-accent" />Interactive demo</span>
    </div>
    <div className="flex h-[40rem] min-h-0 flex-col md:flex-row">
      <div role="tablist" aria-label="Explore product features" className="grid shrink-0 grid-cols-4 gap-2 border-b border-slate-200 bg-slate-50 p-2 md:flex md:w-16 md:flex-col md:items-center md:gap-4 md:border-b-0 md:border-r md:py-4 dark:border-neutral-700/50 dark:bg-[#1F1F1F]">
        <span aria-hidden="true" className="mb-4 hidden h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm md:flex dark:bg-neutral-800"><img src="/brand/icon-light.png" alt="" className="h-8 w-8 object-contain dark:hidden" /><img src="/brand/icon-dark.png" alt="" className="hidden h-8 w-8 object-contain dark:block" /></span>
        {views.map(({ id, label, icon: Icon }, index) => <button key={id} type="button" id={`demo-tab-${id}`} role="tab" aria-label={label} aria-selected={view === id} aria-controls="demo-panel" tabIndex={view === id ? 0 : -1} onKeyDown={event => tabKey(event, index)} onClick={() => onView(id)} className={`relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition-colors duration-200 md:w-12 ${view === id ? "bg-white text-slate-900 shadow-sm dark:bg-[#313131] dark:text-white" : "text-slate-500 hover:bg-slate-200 dark:text-neutral-400 dark:hover:bg-neutral-800"}`}>
          <Icon className={`h-5 w-5 ${view === id ? "text-accent" : ""}`} /><span className="whitespace-nowrap">{label}</span>
        </button>)}
        <span aria-hidden="true" className="mt-auto hidden h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent md:flex">You</span>
      </div>
      <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${view}`} tabIndex={0} className="min-h-0 min-w-0 flex-1">
        <div className={view === "inbox" ? "h-full" : "hidden"}><DemoInbox mobileThread={mobileThread} onMobileThread={setMobileThread} selected={selected} onSelect={setSelected} query={query} onQuery={setQuery} draft={draft} onDraft={setDraft} sent={sent} onSent={setSent} /></div>
        <AnimatePresence mode="wait" initial={false}>{view !== "inbox" && <motion.div key={view} className="h-full" initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}>
        {view === "board" && <div className="h-full overflow-auto p-4 sm:p-8"><h3 className="text-2xl font-semibold tracking-tight">A little more follow through.</h3><p className="mb-6 mt-2 text-sm text-slate-500 dark:text-neutral-400">Click a contact to move them to the next stage. Changes stay in this demo.</p><div className="grid gap-4 sm:grid-cols-3">{["New connection", "In conversation", "Moving forward"].map((title, col) => <section key={title} className="rounded-xl bg-slate-100 p-4 dark:bg-neutral-800"><h4 className="mb-4 flex justify-between text-sm font-medium">{title}<span className="text-slate-400">{stage.filter(value => value === col).length}</span></h4><div className="space-y-3">{people.map((row, index) => stage[index] === col ? <button key={row.name} type="button" onClick={() => setStage(current => current.map((value, i) => i === index ? (value + 1) % 3 : value))} aria-label={`Move ${row.name} to ${["New connection", "In conversation", "Moving forward"][(col + 1) % 3]}`} className="w-full rounded-lg bg-white p-4 text-left transition-transform duration-200 hover:-translate-y-1 dark:bg-neutral-900"><div className="flex items-center gap-3"><DemoAvatar index={index} small /><span className="text-sm font-medium">{row.name}</span></div><p className="mt-4 text-xs text-slate-500 dark:text-neutral-400">{row.note} <span className="float-right" aria-hidden>↗</span></p></button> : null)}</div></section>)}</div></div>}
        {view === "flow" && <div className="flex h-full flex-col items-center overflow-auto p-4 sm:p-8"><div className="w-full"><h3 className="text-2xl font-semibold tracking-tight">A next step, already planned.</h3><p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">Preview a simple workflow. No messages are sent.</p></div><ol className="my-auto w-full max-w-md space-y-4 py-6">{[["When a message arrives", "Contains “pricing”"], ["Organize the conversation", "Add the Interested tag"], ["Keep it on your radar", "Set a follow up reminder"]].map(([title, detail], index) => <li key={title} className={`flex items-center gap-4 rounded-xl border p-4 transition-colors duration-700 ${flowRun ? "border-accent/30 bg-accent/5" : "border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-800"}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm dark:bg-neutral-700">{flowRun ? <CheckIcon className="h-4 w-4 text-accent" /> : `0${index + 1}`}</span><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{detail}</p></div></li>)}</ol><button type="button" onClick={() => setFlowRun(value => !value)} className="rounded-lg bg-slate-900 px-4 py-2 text-base font-semibold text-white dark:bg-white dark:text-black">{flowRun ? "Reset preview" : "Preview workflow"}</button><p role="status" className="mt-3 text-xs text-slate-400">{flowRun ? "Preview complete. Nothing was changed outside this demo." : "You choose the trigger and actions."}</p></div>}
        {view === "assistant" && <div className="flex h-full flex-col items-center justify-center overflow-auto p-4 sm:p-8"><div className="w-full max-w-xl"><SparklesIcon className="mb-6 h-8 w-8 text-accent" /><h3 className="text-3xl font-semibold tracking-tight">It’s somewhere in your chats.</h3><p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">Find the detail without remembering which app it was in.</p><button type="button" onClick={() => setAnswer(true)} className="mt-8 flex w-full items-center justify-between gap-4 rounded-xl bg-slate-200 p-4 text-left text-sm dark:bg-neutral-800">Who asked me to send next steps?<span className="text-accent" aria-hidden>↗</span></button>{answer && <div role="status" className="mt-6"><p className="text-sm leading-relaxed">Maya asked for next steps after approving the new direction. You can pick the conversation up on Telegram.</p><button type="button" onClick={() => openChat(0)} className="mt-4 rounded-lg border border-slate-200 px-4 py-3 text-left text-sm text-accent dark:border-neutral-700">Maya Chen · Telegram <span aria-hidden>↗</span></button></div>}<p className="mt-6 text-xs text-slate-400">Illustrative answer, not a live AI request. In your workspace, connect your own OpenRouter key or skip AI.</p></div></div>}
      </motion.div>}</AnimatePresence>
      </div>
    </div>
  </div>;
}
