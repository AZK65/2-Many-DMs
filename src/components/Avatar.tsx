"use client";

import { useEffect, useRef, useState } from "react";
import { initials, PLATFORMS, type Platform } from "@/lib/platforms";
import { PlatformGlyph } from "./PlatformIcon";
import type { GroupPreviewDTO } from "@/lib/types";
import { avatarSource } from "@/lib/group-avatars";

const SIZES = {
  xs: { box: "h-7 w-7 text-[11px]", badge: "h-3.5 w-3.5", glyph: "h-2 w-2" },
  sm: { box: "h-10 w-10 text-sm", badge: "h-4 w-4", glyph: "h-2.5 w-2.5" },
  md: { box: "h-12 w-12 text-base", badge: "h-5 w-5", glyph: "h-3 w-3" },
  lg: { box: "h-16 w-16 text-xl", badge: "h-6 w-6", glyph: "h-3.5 w-3.5" },
};

function AvatarImage({ src, alt, className, onFailure, lazy = false }: {
  src: string; alt: string; className: string; onFailure: () => void; lazy?: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A cached 404 can finish before React hydrates and attaches onError.
    // Detect it on mount too, so broken image icons never become permanent.
    if (ref.current?.complete && ref.current.naturalWidth === 0) onFailure();
  }, [src, onFailure]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} onError={onFailure}
    loading={lazy ? "lazy" : undefined} decoding="async" className={className} />;
}

export function Avatar({
  name,
  platform,
  size = "sm",
  src,
  showBadge = true,
  group,
  fallbackClassName,
}: {
  name: string;
  platform: Platform;
  size?: keyof typeof SIZES;
  src?: string | null;
  showBadge?: boolean;
  group?: GroupPreviewDTO | null;
  /** Optional identity color for a person's initials; real photos are unchanged. */
  fallbackClassName?: string;
}) {
  const s = SIZES[size];
  const p = PLATFORMS[platform];
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [failedMembers, setFailedMembers] = useState<string[]>([]);
  // Runtime downloads must not rely on Next's startup-time public file list.
  const imageSource = avatarSource(src);
  const members = group?.members ?? [];
  const photos = members.filter(member => member.avatarUrl && !failedMembers.includes(avatarSource(member.avatarUrl)!));
  const tiles = photos.length >= 2 ? photos : members.slice(0, 2);
  const groupLabel = group?.count
    ? `People seen in ${name}: ${members.map(member => member.name).join(", ")}${group.count > members.length ? ` and ${group.count - members.length} more` : ""}. Based on synced messages.`
    : `${name}. No member photos available yet.`;
  return (
    <div className="relative shrink-0">
      {imageSource && failedSource !== imageSource ? (
        <AvatarImage
          src={imageSource}
          alt={name}
          onFailure={() => setFailedSource(imageSource)}
          className={`${s.box} avatar-face ${group ? "avatar-group rounded-xl" : "rounded-full"} object-cover`}
        />
      ) : group && tiles.length > 0 ? (
        <div role="img" aria-label={groupLabel} title={groupLabel}
          className={`${s.box} avatar-face avatar-group grid ${tiles.length > 1 ? "grid-cols-2" : "grid-cols-1"} ${tiles.length > 2 ? "grid-rows-2" : "grid-rows-1"} gap-0.5 overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-black/5 dark:bg-neutral-900 dark:ring-white/10`}>
          {tiles.map((member, index) => {
            const source = avatarSource(member.avatarUrl);
            return <span key={member.id} className={`relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-accent/10 font-medium text-accent dark:bg-accent/20 ${size === "lg" ? "text-sm" : "text-xs"} ${tiles.length === 3 && index === 0 ? "row-span-2" : ""}`}>
              {source && !failedMembers.includes(source) ? (
                <AvatarImage src={source} alt="" lazy
                  onFailure={() => setFailedMembers(current => current.includes(source) ? current : [...current, source])}
                  className="h-full w-full object-cover" />
              ) : <span aria-hidden="true">{initials(member.name)}</span>}
            </span>;
          })}
        </div>
      ) : (
        <div
          role="img" aria-label={name} title={group ? groupLabel : undefined}
          className={`${s.box} avatar-face flex items-center justify-center ${group ? "avatar-group rounded-xl bg-accent/10 text-accent dark:bg-accent/20" : `rounded-full ${fallbackClassName || "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-300"}`} font-semibold`}
        >
          {initials(name)}
        </div>
      )}
      {showBadge && (
        <span
          className={`${s.badge} avatar-platform absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-neutral-900`}
          style={{ backgroundColor: p.bg }}
          title={p.label}
        >
          <PlatformGlyph platform={platform} className={`${s.glyph}`} />
        </span>
      )}
    </div>
  );
}
