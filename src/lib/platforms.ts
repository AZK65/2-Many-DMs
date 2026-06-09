export type Platform = "x" | "whatsapp" | "telegram";

export const PLATFORMS: Record<
  Platform,
  { label: string; color: string; bg: string }
> = {
  x: { label: "X", color: "#ffffff", bg: "#0f1419" },
  whatsapp: { label: "WhatsApp", color: "#ffffff", bg: "#25d366" },
  telegram: { label: "Telegram", color: "#ffffff", bg: "#229ed9" },
};

export const PLATFORM_ORDER: Platform[] = ["x", "whatsapp", "telegram"];

// Deterministic avatar background from a string so the same contact always
// gets the same color, keeping the UI identical regardless of platform.
const AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
