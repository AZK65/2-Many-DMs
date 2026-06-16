"use client";

import { PLATFORMS } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import { TG_LINK } from "@/lib/links";

// Floating "custom integrations & support" bubble shown app-wide.
// To remove it everywhere, delete <SupportBubble /> from src/app/layout.tsx.
export function SupportBubble() {
  return (
    <a
      href={TG_LINK}
      target="_blank"
      rel="noreferrer"
      className="animate-fade-in fixed bottom-4 left-4 z-40 flex max-w-[15rem] items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg transition hover:shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: PLATFORMS.telegram.bg }}
      >
        <PlatformGlyph platform="telegram" className="h-4 w-4" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-xs font-semibold text-slate-800 dark:text-neutral-100">
          Custom integrations & support
        </span>
        <span className="block text-[11px] text-slate-400 dark:text-neutral-500">
          Message me on Telegram ·{" "}
          <span className="font-medium text-accent dark:text-accent">
            paid
          </span>
        </span>
      </span>
    </a>
  );
}
