import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { OmniApi } from "../api";
import { readCache, writeCache } from "../storage";
import { colors, timeAgo } from "../theme";
import type { ContactCard, Conversation } from "../types";
import { Avatar, EmptyState, LoadingState, PageHeader, Pill, PlatformMark, SearchField } from "../components/ui";
import { NativeIcon } from "../components/NativeIcon";

const STAGES = [
  { id: "all", name: "All contacts", color: "#94a3b8" },
  {
    "id": "lead",
    "name": "Lead",
    "color": "#94a3b8"
  },
  {
    "id": "contacted",
    "name": "Contacted",
    "color": "#3b82f6"
  },
  {
    "id": "negotiating",
    "name": "Negotiating",
    "color": "#f59e0b"
  },
  {
    "id": "won",
    "name": "Won",
    "color": "#22c55e"
  },
  {
    "id": "lost",
    "name": "Lost",
    "color": "#ef4444"
  }
];

export function PipelineScreen({ api, conversations, onOpen }: { api: OmniApi; conversations: Conversation[]; onOpen: (conversation: Conversation) => void }) {
  const [contacts, setContacts] = useState<ContactCard[]>([]);
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moving, setMoving] = useState<ContactCard | null>(null);

  async function load() {
    setRefreshing(true);
    try {
      const result = await api.contacts();
      setContacts(result);
      await writeCache("contacts", result);
    } catch (error) {
      if (!contacts.length) Alert.alert("Pipeline unavailable", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    readCache<ContactCard[]>("contacts").then((cached) => cached?.length && setContacts(cached));
    load();
  }, [api]);

  const filtered = useMemo(() => contacts.filter((contact) => {
    if (stage !== "all" && contact.stage !== stage) return false;
    const query = search.trim().toLowerCase();
    return !query || [contact.name, contact.handle, contact.company, contact.email].some((value) => value?.toLowerCase().includes(query));
  }), [contacts, search, stage]);

  async function move(contact: ContactCard, nextStage: string) {
    setMoving(null);
    const previous = contact.stage;
    setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, stage: nextStage } : item));
    try {
      await api.updateContact(contact.id, { stage: nextStage });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, stage: previous } : item));
      Alert.alert("Couldn’t move contact", error instanceof Error ? error.message : "Try again.");
    }
  }

  if (loading && !contacts.length) return <LoadingState label="Loading the pipeline…" />;
  return (
    <View style={styles.fill}>
      <PageHeader title="Pipeline" subtitle={`${contacts.length} contact${contacts.length === 1 ? "" : "s"}`} />
      <SearchField value={search} onChangeText={setSearch} placeholder="Search pipeline" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageRail}>
        {STAGES.map((item) => {
          const selected = item.id === stage;
          const count = item.id === "all" ? contacts.length : contacts.filter((contact) => contact.stage === item.id).length;
          return (
            <Pressable key={item.id} onPress={() => setStage(item.id)} style={[styles.stageChip, selected && { backgroundColor: colors.elevated }]}>
              <View style={[styles.stageDot, { backgroundColor: item.color }]} />
              <Text style={[styles.stageText, selected && { color: colors.text }]}>{item.name}</Text>
              <Text style={[styles.stageCount, selected && { color: item.color }]}>{count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.accent} />}
        contentContainerStyle={filtered.length ? styles.list : styles.emptyList}
        ListEmptyComponent={<EmptyState icon="layers-outline" title="No contacts in this stage" body="Choose another stage or clear your search." />}
        renderItem={({ item }) => {
          const stageInfo = STAGES.find((candidate) => candidate.id === item.stage);
          const conversation = conversations.find((candidate) => candidate.id === item.conversationId);
          return (
            <View style={styles.card}>
              <Pressable disabled={!conversation} onPress={() => conversation && onOpen(conversation)} style={styles.cardMain}>
                <Avatar name={item.name} uri={api.assetUrl(item.avatarUrl)} size={45} />
                <View style={styles.cardCopy}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                    <PlatformMark platform={item.platform} compact />
                  </View>
                  <Text style={styles.cardMeta} numberOfLines={1}>{item.company || item.email || item.handle}</Text>
                  {item.lastMessage ? <Text style={styles.lastMessage} numberOfLines={1}>{item.lastMessage}</Text> : null}
                </View>
              </Pressable>
              <View style={styles.cardFooter}>
                <Pill color={stageInfo?.color || colors.muted}>{stageInfo?.name || "Unassigned"}</Pill>
                <View style={styles.footerRight}>
                  <Text style={styles.age}>{timeAgo(item.lastMessageAt)}</Text>
                  <Pressable onPress={() => setMoving(item)} style={styles.moveButton}>
                    <Text style={styles.moveText}>Move</Text>
                    <NativeIcon name="chevron-down" size={13} color={colors.accent} />
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={!!moving} animationType="slide" transparent onRequestClose={() => setMoving(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMoving(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Move {moving?.name}</Text>
          <Text style={styles.sheetSubtitle}>Choose the new deal stage.</Text>
          <ScrollView contentContainerStyle={styles.sheetList}>
            {STAGES.slice(1).map((item) => (
              <Pressable key={item.id} onPress={() => moving && move(moving, item.id)} style={[styles.sheetRow, moving?.stage === item.id && styles.sheetRowSelected]}>
                <View style={[styles.sheetDot, { backgroundColor: item.color }]} />
                <Text style={styles.sheetRowText}>{item.name}</Text>
                {moving?.stage === item.id ? <NativeIcon name="checkmark" size={19} color={colors.accent} weight="semibold" /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  stageRail: { gap: 8, paddingHorizontal: 16, paddingVertical: 13 },
  stageChip: { height: 34, borderRadius: 17, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12 },
  stageDot: { width: 7, height: 7, borderRadius: 4 },
  stageText: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  stageCount: { color: colors.subtle, fontSize: 12, fontWeight: "600" },
  list: { paddingHorizontal: 16, paddingBottom: 110 },
  emptyList: { flexGrow: 1 },
  card: { marginBottom: 10, borderRadius: 12, backgroundColor: colors.surface, overflow: "hidden" },
  cardMain: { flexDirection: "row", padding: 14, gap: 12 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardName: { color: colors.text, fontSize: 16, fontWeight: "600", flex: 1 },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  lastMessage: { color: colors.subtle, fontSize: 12, marginTop: 7 },
  cardFooter: { minHeight: 45, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  footerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  age: { color: colors.subtle, fontSize: 10 },
  moveButton: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 7, paddingLeft: 8 },
  moveText: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#000000AA" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "78%", borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.surface, paddingTop: 9 },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.subtle, marginBottom: 17 },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: "700", paddingHorizontal: 20 },
  sheetSubtitle: { color: colors.muted, fontSize: 13, marginTop: 5, paddingHorizontal: 20, marginBottom: 12 },
  sheetList: { paddingHorizontal: 12, paddingBottom: 35 },
  sheetRow: { minHeight: 50, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  sheetRowSelected: { backgroundColor: colors.elevated },
  sheetDot: { width: 9, height: 9, borderRadius: 5 },
  sheetRowText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" },
});
