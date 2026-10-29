"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { CheckIcon, SearchIcon, SparklesIcon, ZapIcon } from "../icons";
import { Reveal } from "./MarketingShell";
import type { DemoView } from "./ProductDemo";

const surface = "rounded-xl bg-white p-4 dark:bg-neutral-800";
const muted = "text-sm leading-relaxed text-slate-500 dark:text-neutral-400";

function Card({ id, label, title, description, children, wide = false }: {
  id: string; label: string; title: string; description: string; children: ReactNode; wide?: boolean;
}) {
  return <Reveal className={`min-w-0 ${wide ? "lg:col-span-7" : "lg:col-span-5"}`}>
    <article data-feature={id} className="h-full overflow-hidden rounded-2xl bg-slate-100 p-6 sm:p-8 dark:bg-neutral-900">
      <p className="text-xs font-medium text-accent">{label}</p>
      <h3 className="mt-4 text-3xl font-medium tracking-tight">{title}</h3>
      <p className={`mt-4 max-w-lg ${muted}`}>{description}</p>
      {children}
    </article>
  </Reveal>;
}

const searchRecords = [
  { id: "message", person: "Maya Chen", platform: "Telegram", type: "Message", text: "The brand direction looks great. Can you send the next steps?" },
  { id: "image", person: "Diego Alvarez", platform: "X", type: "Image text", text: "Project brief: brand direction, typography, and a new landing page." },
  { id: "email", person: "Priya Nair", platform: "WhatsApp", type: "Message", text: "Send the brief to priya@sample.example and I’ll introduce the team." },
];

function SearchPreview() {
  const [query, setQuery] = useState("brand");
  const [imagesOnly, setImagesOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const matches = searchRecords.filter(row => (!imagesOnly || row.type === "Image text") && `${row.text} ${row.person}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="mt-8">
    <label className="flex items-center gap-3 rounded-xl bg-white p-4 focus-within:ring-2 focus-within:ring-accent dark:bg-neutral-800">
      <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
      <input aria-label="Search feature examples" value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} placeholder="Try brand or an email" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
    </label>
    <div className="my-4 flex items-center justify-between gap-4">
      <span role="status" className="text-xs text-slate-500 dark:text-neutral-400">{matches.length} sample {matches.length === 1 ? "match" : "matches"}</span>
      <button type="button" onClick={() => { setImagesOnly(value => !value); setSelected(null); }} aria-pressed={imagesOnly} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200 ${imagesOnly ? "bg-accent/10 text-accent" : "bg-white text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"}`}>Image text only</button>
    </div>
    <div className="min-h-48 space-y-3">
      {matches.map(row => <button key={row.id} type="button" onClick={() => setSelected(selected === row.id ? null : row.id)} aria-expanded={selected === row.id} className={`block w-full rounded-xl p-4 text-left transition-colors duration-200 ${selected === row.id ? "bg-accent/10 ring-1 ring-accent/20" : "bg-white hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"}`}>
        <span className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{row.person} · {row.platform}</span><span className="text-slate-500 dark:text-neutral-400">{row.type}</span></span>
        <span className="mt-2 block text-sm leading-relaxed">{row.text}</span>
        {selected === row.id && <span className="mt-3 block text-xs text-accent">Source opened in this sample. In your workspace, jump to the original message.</span>}
      </button>)}
      {!matches.length && <div className="py-8 text-center"><p className={muted}>No sample matches.</p><button type="button" onClick={() => { setQuery("brand"); setImagesOnly(false); }} className="marketing-text-link mt-4">Reset search example</button></div>}
    </div>
    <p className="mt-4 text-xs text-slate-500 dark:text-neutral-400">Fictional results. Real image search needs completed OCR indexing.</p>
  </div>;
}

const networkPeople = [
  { name: "Maya", full: "Maya Chen", initials: "MC", x: 64, y: 48, groups: [0] },
  { name: "Diego", full: "Diego Alvarez", initials: "DA", x: 336, y: 48, groups: [0, 1] },
  { name: "Priya", full: "Priya Nair", initials: "PN", x: 64, y: 200, groups: [1] },
  { name: "Lukas", full: "Lukas Vogt", initials: "LV", x: 336, y: 200, groups: [1] },
];
const groups = [{ name: "Design circle", x: 200, y: 72 }, { name: "Project room", x: 200, y: 184 }];

function NetworkPreview() {
  const [person, setPerson] = useState(1);
  const [zoom, setZoom] = useState(1);
  const selected = networkPeople[person];
  return <div className="mt-8">
    <div className="relative overflow-hidden rounded-xl bg-white dark:bg-black">
      <svg viewBox="0 0 400 250" className="w-full" role="img" aria-label={`Example shared group map. ${selected.full} appears in ${selected.groups.map(index => groups[index].name).join(" and ")}.`}>
        <g transform={`translate(200 125) scale(${zoom}) translate(-200 -125)`}>
          {networkPeople.flatMap((node, index) => node.groups.map(group => <path key={`${index}-${group}`} d={`M${node.x} ${node.y} Q200 125 ${groups[group].x} ${groups[group].y}`} className={person === index ? "stroke-accent" : "stroke-slate-200 dark:stroke-neutral-700"} strokeWidth={person === index ? 2 : 1} fill="none" />))}
          {groups.map(group => <g key={group.name}><rect x={group.x - 52} y={group.y - 16} width="104" height="32" rx="8" className="fill-slate-100 dark:fill-neutral-800" /><text x={group.x} y={group.y + 4} textAnchor="middle" className="fill-slate-500 text-xs dark:fill-neutral-400">{group.name}</text></g>)}
          {networkPeople.map((node, index) => <g key={node.name}><circle cx={node.x} cy={node.y} r="24" className={person === index ? "fill-accent/10 stroke-accent" : "fill-slate-100 stroke-slate-200 dark:fill-neutral-800 dark:stroke-neutral-700"} /><text x={node.x} y={node.y + 5} textAnchor="middle" className={`text-sm font-medium ${person === index ? "fill-accent" : "fill-slate-600 dark:fill-neutral-300"}`}>{node.initials}</text><text x={node.x} y={node.y + 42} textAnchor="middle" className="fill-slate-500 text-xs dark:fill-neutral-400">{node.name}</text></g>)}
        </g>
      </svg>
      <div className="mx-3 mb-3 ml-auto flex w-fit gap-2 rounded-lg bg-slate-100 p-1 dark:bg-neutral-800">
        <button type="button" aria-label="Zoom out of example network" disabled={zoom <= 0.75} onClick={() => setZoom(value => Math.max(0.75, value - 0.25))} className="h-8 w-8 rounded-lg hover:bg-white disabled:opacity-30 dark:hover:bg-neutral-700">−</button>
        <button type="button" aria-label="Reset example network zoom" onClick={() => setZoom(1)} className="rounded-lg px-2 text-xs tabular-nums">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in to example network" disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, value + 0.25))} className="h-8 w-8 rounded-lg hover:bg-white disabled:opacity-30 dark:hover:bg-neutral-700">+</button>
      </div>
    </div>
    <div aria-label="Choose an example person" className="mt-4 flex flex-wrap gap-2">{networkPeople.map((node, index) => <button key={node.name} type="button" aria-pressed={person === index} onClick={() => setPerson(index)} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200 ${person === index ? "bg-accent/10 text-accent" : "bg-white hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"}`}>{node.name}</button>)}</div>
    <p role="status" className="mt-4 text-sm"><span className="font-medium">{selected.full}</span><span className="text-slate-500 dark:text-neutral-400"> · {selected.groups.map(index => groups[index].name).join(" + ")}</span></p>
    <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">Example connections mean shared group activity, not a verified personal relationship.</p>
  </div>;
}

function TranslationPreview() {
  const [language, setLanguage] = useState("French");
  const [phase, setPhase] = useState<"original" | "translating" | "translated">("original");
  const [pageVisible, setPageVisible] = useState(true);
  const preview = useRef<HTMLDivElement>(null);
  const played = useRef(false);
  const inView = useInView(preview, { amount: 0.6 });
  const reduced = useReducedMotion();
  const easing = [0.32, 0.72, 0, 1] as const;
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    update(); document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!inView || !pageVisible || reduced || played.current) return;
    const timer = setTimeout(() => { played.current = true; setPhase("translating"); }, 1200);
    return () => clearTimeout(timer);
  }, [inView, pageVisible, reduced]);
  useEffect(() => {
    if (phase !== "translating" || !inView || !pageVisible) return;
    const timer = setTimeout(() => setPhase("translated"), reduced ? 0 : 1600);
    return () => clearTimeout(timer);
  }, [phase, inView, pageVisible, reduced]);
  const original = language === "French" ? "Parfait, je t’envoie les détails demain matin." : "Perfecto, te envío los detalles mañana por la mañana.";
  const result = "Perfect, I’ll send you the details tomorrow morning.";
  return <div ref={preview} className="mt-8" data-translation-phase={phase}>
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-xs text-slate-500 dark:text-neutral-400">From<select aria-label="Translation example language" value={language} onChange={event => { played.current = true; setLanguage(event.target.value); setPhase("original"); }} className="ml-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-900 dark:bg-neutral-800 dark:text-neutral-200"><option>French</option><option>Spanish</option></select></label><span className="flex items-center gap-3 text-xs text-accent"><motion.span aria-hidden animate={{ x: phase === "translated" && !reduced ? 4 : 0 }} transition={{ duration: reduced ? 0 : 0.5, ease: easing }}>→</motion.span> English</span></div>
    <div className={`${surface} relative mt-4 overflow-hidden`}>
      <p className="text-xs text-slate-500 dark:text-neutral-400">Original · {language}</p><p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">{original}</p>
      <div className="mt-6 min-h-32 border-t border-slate-100 pt-4 dark:border-neutral-700">
        <p role="status" className="mb-3 flex items-center gap-2 text-xs text-accent">{phase === "translated" ? <><CheckIcon className="h-3 w-3" /> English · example translation</> : phase === "translating" ? "Demo · translating on your machine…" : "Ready when you are"}</p>
        <AnimatePresence mode="wait" initial={false}>
          {phase === "translated" ? <motion.p key={`${language}-result`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2 }} className="text-xl leading-relaxed"><span className="sr-only">{result}</span><span aria-hidden>{result.split(" ").map((word, index) => <motion.span key={index} className="inline-block" initial={reduced ? false : { opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : index * 0.05, ease: easing }}>{word}&nbsp;</motion.span>)}</span></motion.p> : <motion.div key={phase} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2 }} className="space-y-3 py-2" aria-hidden><div className={`h-3 w-full rounded bg-slate-100 dark:bg-neutral-700 ${phase === "translating" ? "opacity-100" : "opacity-50"}`} /><div className="h-3 w-2/3 rounded bg-slate-100 opacity-50 dark:bg-neutral-700" /></motion.div>}
        </AnimatePresence>
      </div>
      {phase === "translating" && inView && pageVisible && <motion.div aria-hidden className="absolute bottom-0 left-0 h-1 w-full origin-left bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reduced ? 0 : 1.6, ease: easing }} />}
    </div>
    <button type="button" disabled={phase === "translating"} onClick={() => { played.current = true; setPhase(phase === "translated" ? "original" : "translating"); }} className="marketing-text-link mt-6 disabled:cursor-wait disabled:opacity-50">{phase === "translated" ? "Replay translation" : phase === "translating" ? "Translating example…" : "Translate this example"} <span aria-hidden>↗</span></button>
    <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">A prepared animation, not a live model or speed benchmark. Real translation uses Ollama on your workspace computer; the guided installation includes the model.</p>
  </div>;
}

export function FeatureBento({ onDemo }: { onDemo: (view: DemoView) => void }) {
  return <section id="workspace" className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-8">
    <Reveal><div className="mb-12 grid items-end gap-8 lg:grid-cols-[1.5fr_1fr]"><div><p className="mb-6 text-sm font-medium text-accent">More than a place to reply.</p><h2 className="text-4xl font-medium tracking-tight sm:text-5xl">Your conversations.<br />A whole new perspective.</h2></div><p className="max-w-md text-lg leading-relaxed text-slate-500 dark:text-neutral-400">Find the detail. See the connection. Make the next move. It all starts in your inbox.</p></div></Reveal>
    <div className="grid gap-4 lg:grid-cols-12">
      <Card id="crm" label="01 / CRM" title="Turn a chat into a next step." description="Keep contacts, stages, notes, and reminders beside the conversation. No more remembering who needed what." wide>
        <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3">{[["New", "Maya Chen", "Brand direction"], ["In progress", "Diego Alvarez", "Website brief"], ["Follow up", "Priya Nair", "Introduction"]].map(([stage, name, note]) => <div key={name} className="min-w-0"><p className="mb-3 text-xs font-medium text-slate-500 dark:text-neutral-400">{stage}</p><div className="rounded-xl bg-white p-3 sm:p-4 dark:bg-neutral-800"><span className="mb-6 grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-xs font-medium text-accent">{name.split(" ").map(part => part[0]).join("")}</span><p className="text-sm font-medium">{name}</p><p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">{note}</p></div></div>)}</div>
        <button type="button" onClick={() => onDemo("board")} className="marketing-text-link mt-8">Move a contact in the demo <span aria-hidden>↗</span></button>
      </Card>
      <Card id="flows" label="02 / Flows" title="Give the routine a routine." description="Choose a trigger, organize the conversation, and set the next step. You stay in control of the actions.">
        <ol className="mt-8 space-y-3">{[["Message contains “pricing”", "Trigger"], ["Add the Interested tag", "Organize"], ["Create a follow up", "Remember"]].map(([text, label], index) => <li key={text} className={`${surface} flex items-center gap-4`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-neutral-700">{index === 0 ? <ZapIcon className="h-4 w-4 text-accent" /> : <CheckIcon className="h-4 w-4 text-slate-400" />}</span><div><p className="text-xs text-slate-500 dark:text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{text}</p></div></li>)}</ol>
        <button type="button" onClick={() => onDemo("flow")} className="marketing-text-link mt-8">Run a sample flow <span aria-hidden>↗</span></button>
      </Card>
      <Card id="search" label="03 / Search, seriously" title="Even the text in that image." description="Search messages, emails shared in chats, and indexed image text. Narrow it to one conversation or a platform, then open the source."><SearchPreview /></Card>
      <Card id="network" label="04 / Connection network" title="See who shares a room." description="Explore people and groups on a zoomable map. Follow shared conversations and review possible identity matches before treating people as the same person." wide><NetworkPreview /></Card>
      <Card id="ai" label="05 / Your chat assistant" title="Ask the question. Find the thread." description="Ask about your synced conversations in plain language. Get a useful answer with sources you can open, not another unexplained summary." wide>
        <div className={`${surface} mt-8`}><div className="flex items-start gap-4"><SparklesIcon className="mt-1 h-5 w-5 shrink-0 text-accent" /><div><p className="text-lg font-medium">Who asked me to send next steps?</p><p className={`mt-4 ${muted}`}>Maya asked after approving the new direction. Pick the conversation up on Telegram.</p><span className="mt-6 inline-block rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-neutral-700">Source · Maya Chen ↗</span></div></div></div>
        <button type="button" onClick={() => onDemo("assistant")} className="marketing-text-link mt-6">Try the assistant demo <span aria-hidden>↗</span></button><p className="mt-4 text-xs text-slate-500 dark:text-neutral-400">Illustrative answer. Optional OpenRouter key; relevant chat excerpts go to the model provider when you use AI.</p>
      </Card>
      <Card id="translation" label="06 / Local translation" title="Keep the tone. Cross the language." description="Read a message in English, keep the original, and translate replies for the conversation. Translation stays on your workspace machine, separate from cloud AI."><TranslationPreview /></Card>
    </div>
  </section>;
}
