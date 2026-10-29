"use client";

import { useState } from "react";
import Link from "next/link";

/** Reveal the existing wordmark, without changing the brand or shifting the nav. */
export function TerminalLogo() {
  const [replay, setReplay] = useState(0);
  return <Link href="/landing" aria-label="2Many DMs home" className="block rounded-lg" onMouseEnter={() => setReplay(value => value + 1)} onFocus={() => setReplay(value => value + 1)}>
    <span key={replay} data-terminal-logo className="terminal-logo relative block h-6 w-auto sm:h-8" aria-hidden="true">
      <span className="terminal-logo-ink block h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/lockup-light.png" width="2466" height="546" alt="" className="h-full w-auto dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/lockup-dark.png" width="2466" height="546" alt="" className="hidden h-full w-auto dark:block" />
      </span>
      <span className="terminal-logo-track pointer-events-none absolute inset-0"><span className="terminal-logo-cursor absolute bg-accent" /></span>
    </span>
  </Link>;
}
