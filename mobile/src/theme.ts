import { Platform } from "./types";

export const colors = {
  bg: "#000000",
  grouped: "#000000",
  surface: "#1C1C1E",
  elevated: "#2C2C2E",
  fill: "#3A3A3C",
  border: "#38383A",
  separator: "#38383A",
  text: "#FFFFFF",
  muted: "#EBEBF599",
  subtle: "#EBEBF54D",
  accent: "#0A84FF",
  accentDark: "#0060CC",
  danger: "#FF453A",
  warning: "#FF9F0A",
  info: "#64D2FF",
  success: "#30D158",
  white: "#FFFFFF",
};

export const platformColors: Record<Platform, string> = {
  x: "#FFFFFF",
  whatsapp: "#25D366",
  telegram: "#2AABEE",
  discord: "#7289DA",
  gmail: "#EA4335",
};

export const platformNames: Record<Platform, string> = {
  x: "X",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
  gmail: "Gmail",
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

export function avatarColor(seed: string): string {
  const palette = ["#D05A5A", "#CC7A35", "#A8942A", "#368E68", "#347F8C", "#436FA6", "#705FB0", "#A65388"];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = seed.charCodeAt(index) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

export function timeAgo(value: string | null): string {
  if (!value) return "";
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function sentenceCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}
