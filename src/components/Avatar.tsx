import { avatarColor, initials, PLATFORMS, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";

const SIZES = {
  sm: { box: "h-10 w-10 text-sm", badge: "h-4 w-4", glyph: "h-2.5 w-2.5" },
  md: { box: "h-12 w-12 text-base", badge: "h-5 w-5", glyph: "h-3 w-3" },
  lg: { box: "h-16 w-16 text-xl", badge: "h-6 w-6", glyph: "h-3.5 w-3.5" },
};

export function Avatar({
  name,
  platform,
  size = "sm",
  src,
}: {
  name: string;
  platform: Platform;
  size?: keyof typeof SIZES;
  src?: string | null;
}) {
  const s = SIZES[size];
  const p = PLATFORMS[platform];
  return (
    <div className="relative shrink-0">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={`${s.box} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${s.box} flex items-center justify-center rounded-full font-semibold text-white`}
          style={{ backgroundColor: avatarColor(name) }}
        >
          {initials(name)}
        </div>
      )}
      <span
        className={`${s.badge} absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-neutral-900`}
        style={{ backgroundColor: p.bg }}
        title={p.label}
      >
        <PlatformGlyph
          platform={platform}
          className={`${s.glyph}`}
        />
      </span>
    </div>
  );
}
