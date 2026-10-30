"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { motion, useReducedMotion } from "motion/react";
import { people, DemoAvatar } from "./DemoPeople";
import { ArrowLeftIcon, CheckIcon, CloseIcon, FolderIcon, MailIcon, SearchIcon, SendIcon, SidebarIcon, SmileyIcon, UserIcon } from "../icons";
import { PLATFORMS, type Platform } from "@/lib/platforms";

const groupIndex = people.length;
const chats = [...people, { name: "Studio Common", initials: "SC", platform: "telegram", preview: "Priya: The team is all here. Ready when you are.", time: "09:41", note: "Brand direction", body: "The team is all here. Ready when you are.", email: "", company: "Maya, Priya, and you" }];
const startingUnread = [1, 1, 2, 0, 3];

function ChatAvatar({ index, badge = true }: { index: number; badge?: boolean }) {
  if (index !== groupIndex) return <DemoAvatar index={index} badge={badge} />;
  return <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10" aria-hidden="true"><span className="absolute left-0 top-0 scale-75 origin-top-left"><DemoAvatar index={0} badge={false} small /></span><span className="absolute bottom-0 right-0 rounded-full ring-2 ring-white dark:ring-[#1F1F1F]"><DemoAvatar index={2} badge={false} small /></span></span>;
}

type Props = {
  mobileThread: boolean;
  onMobileThread: (open: boolean) => void;
  selected: number;
  onSelect: (index: number) => void;
  query: string;
  onQuery: (value: string) => void;
  draft: string;
  onDraft: (value: string) => void;
  sent: Record<number, string[]>;
  onSent: Dispatch<SetStateAction<Record<number, string[]>>>;
};

export function DemoInbox({ mobileThread, onMobileThread, selected, onSelect, query, onQuery, draft, onDraft, sent, onSent }: Props) {
  const reduced = useReducedMotion();
  const [compact, setCompact] = useState(false);
  const [details, setDetails] = useState(false);
  const [filter, setFilter] = useState("All");
  const [unread, setUnread] = useState(startingUnread);
  const messageList = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const compose = useRef<HTMLTextAreaElement>(null);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  function closeDetails() { setDetails(false); detailsTrigger.current?.focus(); }
  const previousSent = useRef(sent);
  const chat = chats[selected];
  const isGroup = selected === groupIndex;
  const isDiscord = chat.platform === "discord";
  const results = chats.map((row, index) => ({ row, index })).filter(({ row, index }) =>
    (filter !== "Reply" || unread[index] > 0) && (filter !== "Groups" || index === groupIndex) &&
    `${row.name} ${row.body} ${row.preview} ${row.email} ${row.company} ${row.platform} ${(sent[index] || []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (previousSent.current !== sent) messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: reduced ? "instant" : "smooth" });
    previousSent.current = sent;
  }, [sent, reduced]);

  useEffect(() => {
    if (!compose.current) return;
    compose.current.style.height = "auto";
    compose.current.style.height = `${Math.min(compose.current.scrollHeight, 128)}px`;
  }, [draft, selected]);

  function openChat(index: number) {
    onSelect(index); onDraft(""); onMobileThread(true); setDetails(false);
    messageList.current?.scrollTo({ top: 0 });
  }
  function send() {
    if (!draft.trim() || isDiscord) return;
    onSent(current => ({ ...current, [selected]: [...(current[selected] || []), draft.trim()].slice(-3) }));
    onDraft(""); setUnread(current => current.map((count, index) => index === selected ? 0 : count));
    compose.current?.focus();
  }

  return <div className="flex h-full min-h-0 min-w-0">
    <aside aria-label="Demo conversations" data-compact={compact} className={`${mobileThread ? "hidden md:flex" : "flex"} ${compact ? "md:w-20" : "md:w-72"} min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-neutral-700/50 dark:bg-[#1F1F1F]`}>
      <div className={`border-b border-slate-200 p-4 dark:border-neutral-700/50 ${compact ? "md:px-2" : ""}`}>
        <div className="mb-4 flex items-center justify-between gap-2"><h3 className={`${compact ? "md:hidden" : ""} text-lg font-semibold tracking-tight`}>Messages <span className="ml-1 text-xs font-normal text-slate-400">{chats.length}</span></h3><button type="button" aria-label={compact ? "Expand demo sidebar" : "Collapse demo sidebar"} aria-expanded={!compact} onClick={() => setCompact(value => !value)} className="demo-icon-button hidden md:flex"><SidebarIcon className="h-4 w-4" /></button></div>
        <div className={compact ? "md:hidden" : ""}><label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-slate-400 ring-1 ring-slate-200 focus-within:ring-accent dark:bg-[#272727] dark:ring-neutral-700"><SearchIcon className="h-4 w-4 shrink-0" /><input ref={search} aria-label="Search demo conversations" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search chats, emails…" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none dark:text-neutral-100" /></label>
          <div aria-label="Filter demo conversations" className="mt-4 flex gap-2">{["All", "Reply", "Groups"].map(label => <button type="button" key={label} aria-pressed={filter === label} onClick={() => setFilter(label)} className={`flex min-h-8 flex-1 items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors duration-200 ${filter === label ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:bg-slate-200 dark:text-neutral-400 dark:hover:bg-neutral-800"}`}>{label}<span className="text-slate-400">{label === "All" ? chats.length : label === "Groups" ? 1 : unread.filter(Boolean).length}</span></button>)}</div>
        </div>
        {compact && <button type="button" aria-label="Search demo inbox" onClick={() => { setCompact(false); requestAnimationFrame(() => search.current?.focus()); }} className="demo-icon-button mx-auto hidden md:flex"><SearchIcon className="h-4 w-4" /></button>}
      </div>
      <div className={`flex items-center gap-2 px-4 py-4 text-xs text-slate-400 ${compact ? "md:hidden" : ""}`}><FolderIcon className="h-4 w-4" />All conversations <span className="ml-auto">Newest first</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {results.map(({ row, index }) => <button key={row.name} data-demo-chat={index} aria-label={`Open ${row.name} demo conversation`} aria-current={selected === index ? "true" : undefined} title={row.name} type="button" onClick={() => openChat(index)} className={`relative flex w-full items-center gap-3 px-4 py-4 text-left transition-colors duration-200 ${compact ? "md:justify-center md:px-2" : ""} ${selected === index ? "bg-white dark:bg-[#313131]" : "hover:bg-slate-100 dark:hover:bg-[#272727]"}`}>
          {selected === index && <span aria-hidden="true" className="absolute inset-y-4 left-0 w-0.5 rounded-full bg-accent" />}<ChatAvatar index={index} />
          <span className={`min-w-0 flex-1 ${compact ? "md:hidden" : ""}`}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{row.name}</span><span className="shrink-0 text-xs text-slate-400">{row.time}</span></span><span className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-neutral-400">{sent[index]?.at(-1) ? `You: ${sent[index].at(-1)}` : row.preview}</span>{unread[index] > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent/15 px-1 text-xs text-accent">{unread[index]}</span>}</span></span>
        </button>)}
        {!results.length && <div role="status" className="p-4 text-sm text-slate-500 dark:text-neutral-400">{query ? "No demo conversations match." : "No conversations in this view."}<button onClick={() => { onQuery(""); setFilter("All"); }} type="button" className="mt-4 block rounded text-accent">{query ? "Clear search" : "Show all chats"}</button></div>}
      </div>
      <p className={`flex items-center gap-2 border-t border-slate-200 p-4 text-xs text-slate-400 dark:border-neutral-700/50 ${compact ? "md:hidden" : ""}`}><span className="h-2 w-2 rounded-full bg-accent" />One inbox. Four platforms.</p>
    </aside>

    <section aria-label="Demo message thread" className={`${mobileThread ? "flex" : "hidden md:flex"} relative min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-[#181818]`}>
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-700/50">
        <button type="button" onClick={() => onMobileThread(false)} aria-label="Back to demo conversations" className="demo-icon-button md:hidden"><ArrowLeftIcon className="h-4 w-4" /></button><ChatAvatar index={selected} /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{chat.name}</h3><p className="mt-1 truncate text-xs text-slate-400">{PLATFORMS[chat.platform as Platform].label} · {isGroup ? "3 members" : chat.company}</p></div>
        <button ref={detailsTrigger} type="button" aria-label="Show demo contact details" aria-expanded={details} onClick={() => setDetails(value => !value)} className={`demo-icon-button ${details ? "bg-slate-100 dark:bg-neutral-800" : ""}`}><SidebarIcon className="h-4 w-4" /></button>
      </header>
      <div ref={messageList} data-demo-messages className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center gap-4 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-100 dark:bg-neutral-800" />Today<span className="h-px flex-1 bg-slate-100 dark:bg-neutral-800" /></div>
        {isGroup ? <>
          <div className="flex items-start gap-3"><DemoAvatar index={0} small badge={false} /><div><p className="mb-2 text-xs font-medium text-accent">Maya Chen <span className="ml-2 font-normal text-slate-400">09:38</span></p><p className="text-sm leading-6">Made a little space for the project. Priya’s joining us on the creative side.</p></div></div>
          <div className="flex items-start gap-3"><DemoAvatar index={2} small badge={false} /><div><p className="mb-2 text-xs font-medium text-accent">Priya Nair <span className="ml-2 font-normal text-slate-400">09:41</span></p><p className="text-sm leading-6">{chat.body}</p></div></div>
          <div className="ml-auto max-w-sm rounded-2xl rounded-br-md bg-slate-100 px-4 py-3 text-sm leading-6 dark:bg-[#313131]">Love it. Everything for the launch, in one place.<p className="mt-1 text-right text-xs text-slate-400">09:42</p></div>
        </> : <>
          <div className="flex items-end gap-3"><DemoAvatar index={selected} small badge={false} /><div className="max-w-sm rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm leading-6 dark:bg-[#1F1F1F]">Hey! Just sent the notes over. You can reach me at <span className="text-accent">{chat.email}</span>.<p className="mt-1 text-right text-xs text-slate-400">09:32</p></div></div>
          <div className="ml-auto max-w-sm rounded-2xl rounded-br-md bg-slate-100 px-4 py-3 text-sm leading-6 dark:bg-[#313131]">Got them, thank you. I’ve pulled everything into a plan for us.<p className="mt-1 flex items-center justify-end gap-1 text-xs text-slate-400">10:36 <CheckIcon className="h-3 w-3 text-accent" /></p></div>
          <div className="flex items-end gap-3"><DemoAvatar index={selected} small badge={false} /><div className="max-w-sm"><p className="mb-2 text-xs font-medium text-accent">{chat.name}</p><div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm leading-6 dark:bg-[#1F1F1F]">{chat.body}<p className="mt-1 text-right text-xs text-slate-400">{chat.time}</p></div></div></div>
        </>}
        {(sent[selected] || []).map((message, index) => <motion.div key={index} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.3, ease: [0.32, 0.72, 0, 1] }} className="ml-auto max-w-sm whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent/10 px-4 py-3 text-sm leading-6">{message}<span className="mt-1 block text-right text-xs text-slate-400">Demo only · not sent</span></motion.div>)}
      </div>
      {isDiscord ? <div className="m-4 rounded-xl bg-slate-100 p-4 text-sm dark:bg-[#272727]"><p className="font-medium">Search here. Reply in Discord.</p><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-neutral-400">Discord is read only in 2Many. This sample chat isn’t connected to a real account.</p></div> : <form onSubmit={event => { event.preventDefault(); send(); }} className="shrink-0 p-4 pt-2">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 transition-colors duration-200 focus-within:border-accent dark:border-neutral-700 dark:bg-[#1F1F1F]">
          <button type="button" aria-label="Add a smile to demo reply" onClick={() => { onDraft(`${draft}${draft ? " " : ""}😊`.slice(0, 600)); compose.current?.focus(); }} className="demo-icon-button"><SmileyIcon className="h-4 w-4" /></button>
          <textarea ref={compose} rows={1} aria-label="Try a demo reply" value={draft} maxLength={600} onChange={event => onDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder="Write a message…" className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-6 outline-none" />
          <button type="submit" aria-label="Send demo reply" disabled={!draft.trim()} className="demo-icon-button bg-slate-900 text-white enabled:hover:bg-slate-700 disabled:opacity-25 dark:bg-white dark:text-neutral-900 dark:enabled:hover:bg-neutral-200"><SendIcon className="h-4 w-4" /></button>
        </div><p className="mt-2 text-xs text-slate-400">Try a reply. Nothing leaves this demo.</p>
      </form>}
      {details && <motion.aside initial={{ opacity: 0, x: reduced ? 0 : 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduced ? 0 : 0.3, ease: [0.32, 0.72, 0, 1] }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeDetails(); } }} aria-label="Demo contact details" className="absolute inset-x-0 bottom-0 top-16 z-10 overflow-y-auto border-l border-slate-200 bg-slate-50 p-6 shadow-xl sm:left-auto sm:w-64 dark:border-neutral-700 dark:bg-[#1F1F1F]">
        <div className="mb-6 flex items-center justify-between"><h4 className="text-sm font-semibold">{isGroup ? "Group info" : "Contact info"}</h4><button type="button" aria-label="Close demo contact details" autoFocus onClick={closeDetails} className="demo-icon-button"><CloseIcon className="h-4 w-4" /></button></div>
        <ChatAvatar index={selected} badge={false} /><h4 className="mt-4 text-lg font-semibold">{chat.name}</h4><p className="mt-1 text-sm text-slate-400">{chat.company}</p>
        <dl className="mt-6 space-y-6 text-sm"><div><dt className="mb-2 flex items-center gap-2 text-xs text-slate-400"><UserIcon className="h-4 w-4" />{isGroup ? "Members" : "Company"}</dt><dd>{chat.company}</dd></div>{chat.email && <div><dt className="mb-2 flex items-center gap-2 text-xs text-slate-400"><MailIcon className="h-4 w-4" />Email</dt><dd className="break-all">{chat.email}</dd></div>}<div><dt className="mb-2 text-xs text-slate-400">Topic</dt><dd className="inline-flex rounded-md bg-accent/10 px-2 py-1 text-xs text-accent">{chat.note}</dd></div></dl>
        {isGroup && <div className="mt-6 flex gap-2"><DemoAvatar index={0} badge={false} /><DemoAvatar index={2} badge={false} /></div>}
        <p className="mt-8 text-xs leading-5 text-slate-400">Fictional contact details. Your own workspace uses the contacts and conversations you connect.</p>
      </motion.aside>}
    </section>
  </div>;
}
