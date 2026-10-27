import SegmentedControl from "@react-native-segmented-control/segmented-control";
import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, avatarColor, initials, platformColors, platformNames } from "../theme";
import type { Platform } from "../types";
import { NativeIcon, type NativeIconName } from "./NativeIcon";

export function Avatar({ name, uri, size = 46 }: { name: string; uri?: string | null; size?: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[styles.avatarImage, shape]} />;
  return <View style={[styles.avatarFallback, shape, { backgroundColor: avatarColor(name) }]}><Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials(name)}</Text></View>;
}

export function PlatformMark({ platform, compact = false }: { platform: Platform; compact?: boolean }) {
  const icon = { x: "logo-twitter", whatsapp: "logo-whatsapp", telegram: "paper-plane", discord: "logo-discord", gmail: "mail" }[platform];
  return (
    <View style={[styles.platform, compact && styles.platformCompact]}>
      {platform === "x" ? <Text style={[styles.xMark, { color: platformColors.x }]}>𝕏</Text> : <NativeIcon name={icon} size={compact ? 12 : 14} color={platformColors[platform]} weight="semibold" />}
      {!compact ? <Text style={styles.platformText}>{platformNames[platform]}</Text> : null}
    </View>
  );
}

export function PageHeader({ title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: React.ReactNode }) {
  return <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{action ? <View style={styles.headerAction}>{action}</View> : null}</View>;
}

export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return <View style={styles.searchWrap}><NativeIcon name="search" size={17} color={colors.muted} /><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} selectionColor={colors.accent} style={styles.searchInput} returnKeyType="search" clearButtonMode="while-editing" /></View>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <View style={styles.segmentedWrap}>
      <SegmentedControl values={options.map((option) => `${option.label}${option.count === undefined ? "" : ` ${option.count}`}`)} selectedIndex={Math.max(0, options.findIndex((option) => option.value === value))} onChange={(event) => onChange(options[event.nativeEvent.selectedSegmentIndex].value)} appearance="dark" tintColor={colors.fill} backgroundColor={colors.elevated} fontStyle={styles.segmentFont} activeFontStyle={styles.segmentActiveFont} style={styles.segmented} />
    </View>
  );
}

export function IconButton({ name, onPress, active = false, danger = false, disabled = false, label }: { name: NativeIconName; onPress: () => void; active?: boolean; danger?: boolean; disabled?: boolean; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.pressed]}><NativeIcon name={name} size={21} color={danger ? colors.danger : active ? colors.warning : colors.accent} weight="semibold" /></Pressable>;
}

export function PrimaryButton({ children, onPress, disabled = false, icon, style }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; icon?: NativeIconName; style?: StyleProp<ViewStyle> }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, style, disabled && styles.disabled, pressed && styles.pressed]}>{icon ? <NativeIcon name={icon} size={17} color={colors.white} weight="semibold" /> : null}<Text style={styles.primaryButtonText}>{children}</Text></Pressable>;
}

export function SecondaryButton({ children, onPress, disabled = false, icon, danger = false, style }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; icon?: NativeIconName; danger?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryButton, style, disabled && styles.disabled, pressed && styles.pressed]}>{icon ? <NativeIcon name={icon} size={17} color={danger ? colors.danger : colors.accent} weight="semibold" /> : null}<Text style={[styles.secondaryButtonText, danger && { color: colors.danger }]}>{children}</Text></Pressable>;
}

export function Pill({ children, color = colors.muted }: { children: React.ReactNode; color?: string }) { return <Text style={[styles.pillText, { color }]}>{children}</Text>; }
export function EmptyState({ icon, title, body }: { icon: NativeIconName; title: string; body: string }) { return <View style={styles.empty}><NativeIcon name={icon} size={44} color={colors.subtle} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>; }
export function LoadingState({ label = "Loading your workspace…" }: { label?: string }) { return <View style={styles.loading}><ActivityIndicator color={colors.muted} /><Text style={styles.loadingText}>{label}</Text></View>; }
export function OfflineNotice({ visible }: { visible: boolean }) { if (!visible) return null; return <View style={styles.offline}><NativeIcon name="cloud-offline-outline" size={15} color={colors.warning} /><Text style={styles.offlineText}>Showing the last on-device copy</Text></View>; }

const styles = StyleSheet.create({
  avatarImage: { backgroundColor: colors.elevated }, avatarFallback: { alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.white, fontWeight: "700", letterSpacing: -0.4 },
  platform: { height: 25, flexDirection: "row", gap: 5, alignItems: "center" }, platformCompact: { width: 22, justifyContent: "center" }, platformText: { color: colors.muted, fontSize: 12, fontWeight: "500" }, xMark: { fontSize: 13, fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 }, headerCopy: { flex: 1, paddingRight: 12 }, headerAction: { paddingBottom: 2 }, title: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.2 }, subtitle: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  searchWrap: { height: 36, flexDirection: "row", alignItems: "center", marginHorizontal: 16, paddingHorizontal: 9, gap: 7, borderRadius: 10, backgroundColor: colors.elevated }, searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  segmentedWrap: { marginHorizontal: 16, marginVertical: 12 }, segmented: { height: 32 }, segmentFont: { color: colors.muted, fontSize: 12, fontWeight: "500" }, segmentActiveFont: { color: colors.text, fontSize: 12, fontWeight: "600" },
  iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  primaryButton: { minHeight: 50, paddingHorizontal: 18, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }, primaryButtonText: { color: colors.white, fontSize: 17, fontWeight: "600" },
  secondaryButton: { minHeight: 46, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, secondaryButtonText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  pillText: { fontSize: 12, fontWeight: "600" }, empty: { paddingHorizontal: 38, paddingVertical: 70, alignItems: "center" }, emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "600", marginTop: 16, marginBottom: 7 }, emptyBody: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 13, padding: 30, backgroundColor: colors.bg }, loadingText: { color: colors.muted, fontSize: 14 }, offline: { marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", gap: 7, alignItems: "center", backgroundColor: colors.surface, borderRadius: 10 }, offlineText: { color: colors.warning, fontSize: 13, fontWeight: "500" }, disabled: { opacity: 0.4 }, pressed: { opacity: 0.45 },
});
