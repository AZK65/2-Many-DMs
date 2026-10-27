import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { OmniApi } from "../api";
import type { Conversation } from "../types";
import { colors, timeAgo } from "../theme";
import { Avatar, EmptyState, IconButton, LoadingState, OfflineNotice, PageHeader, PlatformMark, SearchField, Segmented } from "../components/ui";
import { NativeIcon } from "../components/NativeIcon";

type Filter = "active" | "reply" | "followup";

export function InboxScreen({
  api,
  conversations,
  loading,
  refreshing,
  offline,
  onRefresh,
  onOpen,
  onUpdate,
}: {
  api: OmniApi;
  conversations: Conversation[];
  loading: boolean;
  refreshing: boolean;
  offline: boolean;
  onRefresh: () => void;
  onOpen: (conversation: Conversation) => void;
  onUpdate: (id: string, patch: Partial<Conversation>) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const visible = useMemo(() => conversations.filter((conversation) => {
    if (conversation.hidden || conversation.inboxCategory === "spam") return false;
    if (filter === "active" && conversation.status === "done") return false;
    if (filter === "reply" && !(conversation.status === "open" && conversation.lastDirection === "in")) return false;
    if (filter === "followup" && !(conversation.followUpAt && new Date(conversation.followUpAt) <= new Date())) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [conversation.contact.name, conversation.contact.handle, conversation.contact.company, conversation.lastMessage]
      .some((value) => value?.toLowerCase().includes(query));
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()), [conversations, filter, search]);

  const replyCount = conversations.filter((item) => !item.hidden && item.status === "open" && item.lastDirection === "in").length;
  const followupCount = conversations.filter((item) => item.followUpAt && new Date(item.followUpAt) <= new Date()).length;

  async function showActions(conversation: Conversation) {
    await Haptics.selectionAsync();
    Alert.alert(conversation.contact.name, "Quick action", [
      {
        text: conversation.priority ? "Remove priority" : "Mark priority",
        onPress: () => onUpdate(conversation.id, { priority: !conversation.priority }),
      },
      {
        text: conversation.todo ? "Remove from tasks" : "Add to tasks",
        onPress: () => onUpdate(conversation.id, { todo: !conversation.todo }),
      },
      {
        text: conversation.status === "done" ? "Reopen" : "Mark done",
        onPress: () => onUpdate(conversation.id, { status: conversation.status === "done" ? "open" : "done" }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  if (loading && !conversations.length) return <LoadingState />;
  return (
    <View style={styles.fill}>
      <PageHeader
        title="Inbox"
        subtitle={`${conversations.reduce((sum, item) => sum + item.unread, 0)} unread across every channel`}
        action={<IconButton name="refresh" onPress={onRefresh} disabled={refreshing} label="Refresh inbox" />}
      />
      <OfflineNotice visible={offline} />
      <SearchField value={search} onChangeText={setSearch} placeholder="Search people and messages" />
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "active", label: "Active", count: conversations.filter((item) => !item.hidden && item.status !== "done").length },
          { value: "reply", label: "Needs reply", count: replyCount },
          { value: "followup", label: "Follow-up", count: followupCount },
        ]}
      />
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        contentContainerStyle={visible.length ? styles.list : styles.emptyList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<EmptyState icon="mail-open-outline" title="Nothing waiting here" body="You’re caught up. Pull down to check the private server again." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item)} onLongPress={() => showActions(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View>
              <Avatar name={item.contact.name} uri={api.assetUrl(item.contact.avatarUrl)} size={50} />
              <View style={styles.platformFloat}><PlatformMark platform={item.platform} compact /></View>
            </View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <View style={styles.nameWrap}>
                  {item.priority ? <NativeIcon name="flash" size={12} color={colors.warning} /> : null}
                  <Text style={[styles.name, item.unread > 0 && styles.nameUnread]} numberOfLines={1}>{item.contact.name}</Text>
                  {item.isGroup ? <NativeIcon name="people" size={12} color={colors.subtle} /> : null}
                </View>
                <Text style={[styles.time, item.unread > 0 && styles.timeUnread]}>{timeAgo(item.lastMessageAt)}</Text>
              </View>
              <View style={styles.metaRow}>
                {item.contact.company ? <Text style={styles.company} numberOfLines={1}>{item.contact.company}</Text> : <Text style={styles.handle} numberOfLines={1}>{item.contact.handle}</Text>}
                {item.account?.label ? <Text style={styles.via} numberOfLines={1}>via {item.account.label}</Text> : null}
              </View>
              <View style={styles.previewRow}>
                <Text style={[styles.preview, item.unread > 0 && styles.previewUnread]} numberOfLines={1}>
                  {item.lastDirection === "out" ? "You: " : ""}{item.lastMessage || "No messages yet"}
                </Text>
                {item.todo ? <NativeIcon name="checkbox-outline" size={15} color={colors.info} /> : null}
                {item.unread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{item.unread > 99 ? "99+" : item.unread}</Text></View> : null}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 100 },
  emptyList: { flexGrow: 1, paddingBottom: 100 },
  row: { minHeight: 78, paddingVertical: 11, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bg },
  rowPressed: { opacity: 0.65 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: 78 },
  platformFloat: { position: "absolute", right: -4, bottom: -3 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  nameWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: colors.text, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  nameUnread: { fontWeight: "700" },
  time: { color: colors.muted, fontSize: 12 },
  timeUnread: { color: colors.accent, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  company: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  handle: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  via: { color: colors.subtle, fontSize: 10, flexShrink: 1 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 7 },
  preview: { color: colors.subtle, fontSize: 13, flex: 1 },
  previewUnread: { color: colors.muted },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "600" },
});
