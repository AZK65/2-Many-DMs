import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { OmniApi } from "../api";
import { readCache, writeCache } from "../storage";
import { colors, timeAgo } from "../theme";
import type { ListeningResponse, SocialLead } from "../types";
import { EmptyState, LoadingState, PageHeader, Pill, Segmented } from "../components/ui";
import { NativeIcon } from "../components/NativeIcon";

type Kind = "lead" | "support";
type StatusFilter = "new" | "all";

export function ListeningScreen({ api }: { api: OmniApi }) {
  const [kind, setKind] = useState<Kind>("lead");
  const [status, setStatus] = useState<StatusFilter>("new");
  const [data, setData] = useState<ListeningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(nextKind = kind) {
    setRefreshing(true);
    try {
      const result = await api.listening(nextKind);
      setData(result);
      await writeCache(`listening.${nextKind}`, result);
    } catch (error) {
      if (!data) Alert.alert("Listening feed unavailable", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    readCache<ListeningResponse>(`listening.${kind}`).then((cached) => cached && setData(cached));
    load(kind);
  }, [api, kind]);

  const leads = useMemo(() => (data?.leads || []).filter((item) => status === "all" || item.status === "new"), [data, status]);

  async function update(lead: SocialLead, patch: Partial<SocialLead>) {
    const previous = data;
    setData((current) => current ? { ...current, leads: current.leads.map((item) => item.id === lead.id ? { ...item, ...patch } : item) } : current);
    try {
      const result = await api.updateLead(lead.id, patch);
      setData((current) => current ? { ...current, leads: current.leads.map((item) => item.id === lead.id ? result.lead : item) } : current);
      await Haptics.selectionAsync();
    } catch (error) {
      setData(previous);
      Alert.alert("Lead not updated", error instanceof Error ? error.message : "Try again.");
    }
  }

  if (loading && !data) return <LoadingState label="Scanning the listening feed…" />;
  return (
    <View style={styles.fill}>
      <PageHeader
        title="Listening"
        subtitle={data?.lastRun ? `Last scan ${timeAgo(data.lastRun.createdAt)} ago · ${data.lastRun.fresh} new` : "Qualified opportunities and support mentions"}
      />
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "lead", label: "Opportunities", count: (data?.counts.hot || 0) + (data?.counts.warm || 0) },
          { value: "support", label: "Support", count: data?.counts.supportNew || 0 },
        ]}
      />
      <View style={styles.filterRow}>
        {(["new", "all"] as const).map((value) => (
          <Pressable key={value} onPress={() => setStatus(value)} style={[styles.filter, status === value && styles.filterActive]}>
            <Text style={[styles.filterText, status === value && styles.filterTextActive]}>{value === "new" ? "New" : "All activity"}</Text>
          </Pressable>
        ))}
        <View style={styles.filterSpacer} />
        <Pressable onPress={() => load()} hitSlop={10}><NativeIcon name="refresh" size={18} color={colors.accent} /></Pressable>
      </View>
      <FlatList
        data={leads}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} tintColor={colors.accent} />}
        contentContainerStyle={leads.length ? styles.list : styles.emptyList}
        ListEmptyComponent={<EmptyState icon="radio-outline" title="No mentions here" body="The listener has not found any matching posts in this view." />}
        renderItem={({ item }) => (
          <View style={[styles.card, item.tier === "HOT" && styles.hotCard]}>
            <View style={styles.cardTop}>
              <View style={styles.tierWrap}>
                <Pill color={item.tier === "HOT" ? colors.danger : colors.warning}>{item.tier}</Pill>
                {item.status !== "new" ? <Pill color={item.status === "contacted" ? colors.accent : colors.muted}>{item.status}</Pill> : null}
              </View>
              <Text style={styles.age}>{timeAgo(item.postedAt || item.receivedAt)}</Text>
            </View>
            <View style={styles.authorRow}>
              <View style={styles.xAvatar}><Text style={styles.xAvatarText}>{(item.displayName || item.username)[0]?.toUpperCase()}</Text></View>
              <View style={styles.authorCopy}>
                <Text style={styles.displayName}>{item.displayName || item.username}</Text>
                <Text style={styles.username}>@{item.username}{item.followers ? ` · ${item.followers} followers` : ""}</Text>
              </View>
              <Text style={styles.xLogo}>𝕏</Text>
            </View>
            <Text style={styles.content}>{item.content}</Text>
            {item.reason ? (
              <View style={styles.reason}>
                <NativeIcon name="sparkles" size={14} color={colors.info} />
                <Text style={styles.reasonText}>{item.reason}</Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              <Pressable onPress={() => Linking.openURL(item.url)} style={styles.openButton}>
                <NativeIcon name="open-outline" size={16} color={colors.accent} />
                <Text style={styles.openText}>Open post</Text>
              </Pressable>
              <Pressable onPress={() => update(item, { rating: item.rating === "good" ? null : "good" })} style={[styles.smallButton, item.rating === "good" && styles.smallButtonActive]}>
                <NativeIcon name="thumbs-up-outline" size={16} color={item.rating === "good" ? colors.accent : colors.muted} />
              </Pressable>
              <Pressable onPress={() => update(item, { status: item.status === "contacted" ? "new" : "contacted" })} style={[styles.contactButton, item.status === "contacted" && styles.contactButtonDone]}>
                <NativeIcon name={item.status === "contacted" ? "checkmark" : "paper-plane-outline"} size={16} color={colors.white} />
                <Text style={[styles.contactText, item.status === "contacted" && styles.contactTextDone]}>{item.status === "contacted" ? "Contacted" : "Mark contacted"}</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  filterRow: { height: 39, marginHorizontal: 17, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  filter: { height: 31, paddingHorizontal: 11, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  filterActive: { backgroundColor: colors.elevated },
  filterText: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  filterTextActive: { color: colors.text, fontWeight: "600" },
  filterSpacer: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 110 },
  emptyList: { flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 12 },
  hotCard: { backgroundColor: "#251C1C" },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tierWrap: { flexDirection: "row", gap: 6 },
  age: { color: colors.subtle, fontSize: 10 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 13 },
  xAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.elevated, alignItems: "center", justifyContent: "center" },
  xAvatarText: { color: colors.text, fontWeight: "600" }, xLogo: { color: colors.text, fontSize: 17, fontWeight: "600" },
  authorCopy: { flex: 1 },
  displayName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  username: { color: colors.subtle, fontSize: 11, marginTop: 2 },
  content: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 13 },
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 10, marginTop: 12, borderRadius: 10, backgroundColor: colors.elevated },
  reasonText: { color: colors.muted, fontSize: 12, lineHeight: 17, flex: 1 },
  actions: { flexDirection: "row", gap: 7, marginTop: 13 },
  openButton: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 11, borderRadius: 10, backgroundColor: colors.elevated },
  openText: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  smallButton: { width: 40, minHeight: 38, borderRadius: 10, backgroundColor: colors.elevated, alignItems: "center", justifyContent: "center" },
  smallButtonActive: { backgroundColor: colors.fill },
  contactButton: { flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: colors.accent, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  contactButtonDone: { backgroundColor: colors.success },
  contactText: { color: colors.white, fontSize: 13, fontWeight: "600" },
  contactTextDone: { color: colors.white },
});
