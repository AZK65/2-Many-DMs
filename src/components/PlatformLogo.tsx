import type { Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";

// Local brand assets, so setup never depends on a third-party image request.
// Telegram: telegram.org/img/t_logo.svg (telegram.org/tour/screenshots)
// WhatsApp: static.whatsapp.net/rsrc.php/y1/r/FJbTMJqMap7.svg (whatsapp.com)
// Discord: official symbol linked from discord.com/branding; white on Blurple.
// X retains the existing X mark, white on black.
export function PlatformLogo({ platform, className = "h-10 w-10" }: { platform: Platform; className?: string }) {
  const surface = platform === "discord" ? "bg-[#5865f2] p-2" : platform === "x" ? "bg-black p-2 text-white" : platform === "whatsapp" ? "bg-white p-1.5" : platform === "telegram" ? "" : "bg-white p-2 text-red-600";
  return <span aria-hidden="true" data-platform-logo={platform} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${surface} ${className}`}>
    {platform === "telegram" || platform === "whatsapp" || platform === "discord"
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={`/brand/platforms/${platform}.svg`} alt="" width={40} height={40} draggable={false} className="h-full w-full object-contain" />
      : <PlatformGlyph platform={platform} className="h-full w-full" />}
  </span>;
}
