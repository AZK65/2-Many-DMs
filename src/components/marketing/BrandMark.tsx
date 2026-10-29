import { PLATFORMS, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "../PlatformIcon";

/** Platform identity colours are separate from the site's action accent. */
export function BrandMark({ platform, className = "h-10 w-10" }: { platform: Platform; className?: string }) {
  return <span aria-hidden data-brand-platform={platform} className={`inline-flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-black/5 dark:ring-white/15 ${className}`} style={{ backgroundColor: PLATFORMS[platform].bg, color: PLATFORMS[platform].color }}>
    {platform === "telegram" ? <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" fill="currentColor"><path d="M21 3 2.5 10.3c-.8.3-.8.8-.1 1l4.7 1.5 1.8 5.6c.2.6.3.7.8.2l2.6-2.5 4.9 3.6c.6.4 1 .2 1.2-.5L21.8 4c.2-.9-.2-1.3-.8-1ZM8.5 12.3l10-6.2-7.9 7.3-.6 3.5-1.5-4.6Z" /></svg> : <PlatformGlyph platform={platform} className="h-3/5 w-3/5" />}
  </span>;
}
