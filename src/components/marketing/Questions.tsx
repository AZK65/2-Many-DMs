"use client";

import { useState } from "react";

export function Questions({ items }: { items: readonly (readonly string[])[] }) {
  const [expanded, setExpanded] = useState(() => new Set([0]));
  function toggle(index: number) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }
  return <div className="mt-8 grid items-start gap-4 md:grid-cols-2">
    {items.map(([question, answer], index) => {
      const open = expanded.has(index);
      return <article key={question} data-faq-item data-open={open} className={`rounded-xl p-4 transition-colors duration-700 sm:p-6 ${open ? "bg-slate-100 dark:bg-neutral-900" : "bg-slate-50 hover:bg-slate-100 dark:bg-neutral-900/50 dark:hover:bg-neutral-900"}`}>
        <h3><button id={`faq-question-${index}`} type="button" aria-expanded={open} aria-controls={`faq-answer-${index}`} onClick={() => toggle(index)} className="flex min-h-12 w-full items-center justify-between gap-4 rounded-lg text-left text-base font-medium sm:text-lg">
          <span>{question}</span>
          <span aria-hidden="true" className="relative h-6 w-6 shrink-0 text-accent"><span className="absolute left-1 top-3 h-px w-4 bg-current" /><span className={`absolute left-1 top-3 h-px w-4 bg-current transition-transform duration-700 ${open ? "rotate-0" : "rotate-90"}`} /></span>
        </button></h3>
        <div id={`faq-answer-${index}`} aria-labelledby={`faq-question-${index}`} aria-hidden={!open} className="marketing-faq-answer" data-open={open}>
          <div className="min-h-0 overflow-hidden"><p className={`max-w-xl pb-2 pt-4 text-sm leading-relaxed text-slate-500 transition-[opacity,transform] duration-700 dark:text-neutral-400 ${open ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}>{answer}</p></div>
        </div>
      </article>;
    })}
  </div>;
}
