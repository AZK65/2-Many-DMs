import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import React from "react";
import { Platform, type ColorValue } from "react-native";

const symbols: Record<string, string> = {
  add: "plus", "alert-circle": "exclamationmark.circle.fill", "arrow-forward": "arrow.right", "arrow-up": "arrow.up",
  chatbubbles: "bubble.left.and.bubble.right.fill", "chatbubbles-outline": "bubble.left.and.bubble.right",
  checkbox: "checkmark.square.fill", "checkbox-outline": "checkmark.square", checkmark: "checkmark",
  "checkmark-circle": "checkmark.circle.fill", "checkmark-circle-outline": "checkmark.circle", "checkmark-done": "checkmark",
  "chevron-back": "chevron.left", "chevron-down": "chevron.down", "chevron-forward": "chevron.right", "close-circle": "xmark.circle.fill", "close-circle-outline": "xmark.circle",
  "cloud-offline-outline": "icloud.slash", desktop: "macbook.and.iphone", "desktop-outline": "macbook.and.iphone",
  document: "doc.fill", "ellipse-outline": "circle", flash: "bolt.fill", "flash-outline": "bolt",
  grid: "ellipsis.circle.fill", "grid-outline": "ellipsis.circle", layers: "square.stack.3d.up.fill", "layers-outline": "square.stack.3d.up",
  "lock-closed": "lock.fill", "logo-twitter": "at", mail: "envelope.fill", "mail-open-outline": "envelope.open",
  mic: "mic.fill", "open-outline": "arrow.up.forward.square", "paper-plane": "paperplane.fill", "paper-plane-outline": "paperplane", people: "person.2.fill", play: "play.fill",
  radio: "dot.radiowaves.left.and.right", "radio-outline": "dot.radiowaves.left.and.right", refresh: "arrow.clockwise",
  scan: "faceid", "scan-outline": "faceid", search: "magnifyingglass", "shield-checkmark": "checkmark.shield.fill",
  sparkles: "sparkles", "sparkles-outline": "sparkles", "thumbs-up-outline": "hand.thumbsup", "time-outline": "clock",
  unlink: "link.badge.plus", "unlink-outline": "link.badge.plus", videocam: "video.fill",
};

export type NativeIconName = string;

export function NativeIcon({ name, size = 20, color, weight = "regular" }: { name: NativeIconName; size?: number; color: ColorValue; weight?: "regular" | "medium" | "semibold" | "bold" }) {
  if (Platform.OS !== "ios" || name.startsWith("logo-")) return <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color={color as string} />;
  return <SymbolView name={(symbols[name] || name) as SymbolViewProps["name"]} size={size} tintColor={color} weight={weight} type="monochrome" fallback={<Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color={color as string} />} />;
}
