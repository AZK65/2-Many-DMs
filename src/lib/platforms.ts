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

// What each platform can send. Types differ: Telegram takes any file, WhatsApp
// takes media + documents, X only photos/GIFs/videos.
export type SendableMediaType = "image" | "video" | "audio" | "file";

export interface AttachmentCaps {
  accept: string; // <input accept> attribute
  types: SendableMediaType[];
  hint: string; // shown in the attach tooltip
}

export const PLATFORM_ATTACHMENTS: Record<Platform, AttachmentCaps> = {
  telegram: {
    accept: "*/*",
    types: ["image", "video", "audio", "file"],
    hint: "Photos, videos, audio or any file",
  },
  whatsapp: {
    accept:
      "image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip",
    types: ["image", "video", "audio", "file"],
    hint: "Photos, videos, audio or documents",
  },
  x: {
    accept: "image/*,video/*",
    types: ["image", "video"],
    hint: "Photos, GIFs or videos only",
  },
};

// Map a file's MIME type to the stored media category.
export function mimeToMediaType(mime: string): SendableMediaType {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

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
