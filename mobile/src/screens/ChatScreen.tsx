import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { OmniApi } from "../api";
import { readCache, writeCache } from "../storage";
import { colors, timeAgo } from "../theme";
import type { Conversation, LocalFile, Message } from "../types";
import { Avatar, IconButton, PlatformMark } from "../components/ui";
import { NativeIcon } from "../components/NativeIcon";

export function ChatScreen({
  api,
  conversation,
  onBack,
  onPatch,
}: {
  api: OmniApi;
  conversation: Conversation;
  onBack: () => void;
  onPatch: (patch: Partial<Conversation>) => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  async function load(markRead = false, quiet = false) {
    if (!quiet) setRefreshing(true);
    try {
      const result = await api.messages(conversation.id, markRead);
      setMessages(result.messages);
      await writeCache(`messages.${conversation.id}`, result.messages);
    } catch (error) {
      if (!messages.length && !quiet) Alert.alert("Messages unavailable", error instanceof Error ? error.message : "Try again shortly.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    readCache<Message[]>(`messages.${conversation.id}`).then((cached) => {
      if (alive && cached?.length) setMessages(cached);
    });
    load(true);
    const poll = setInterval(() => load(false, true), 6_000);
    return () => { alive = false; clearInterval(poll); };
  }, [conversation.id]);

  useEffect(() => {
    if (!loading && messages.length) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, [loading]);

  async function sendText() {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    setSending(true);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`, body, direction: "out", mediaType: null, mediaUrl: null, mediaName: null,
      createdAt: new Date().toISOString(), replyToExternalKey: null, replyPreview: null, replySender: null,
      deliveryStatus: "sending", senderName: null, senderAvatarUrl: null, senderTags: [],
    };
    setMessages((current) => [...current, optimistic]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    try {
      const saved = await api.sendMessage(conversation.id, body);
      setMessages((current) => current.map((item) => item.id === optimistic.id ? saved : item));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === optimistic.id ? { ...item, deliveryStatus: "failed", deliveryError: error instanceof Error ? error.message : "Send failed" } : item));
      setDraft(body);
      Alert.alert("Message not sent", error instanceof Error ? error.message : "Check the connected channel and try again.");
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file: LocalFile) {
    setSending(true);
    try {
      const message = await api.sendFile(conversation.id, file, draft.trim());
      setDraft("");
      setMessages((current) => [...current, message]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      Alert.alert("Attachment not sent", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSending(false);
    }
  }

  async function chooseMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    await sendFile({ uri: asset.uri, name: asset.fileName || `photo-${Date.now()}.jpg`, mimeType: asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg") });
  }

  async function chooseDocument() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    await sendFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "application/octet-stream" });
  }

  function attachmentMenu() {
    Alert.alert("Send attachment", undefined, [
      { text: "Photo or video", onPress: chooseMedia },
      { text: "Document", onPress: chooseDocument },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function patch(patchValue: Partial<Conversation>) {
    try {
      await onPatch(patchValue);
      await Haptics.selectionAsync();
    } catch (error) {
      Alert.alert("Couldn’t update conversation", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      <View style={styles.header}>
        <IconButton name="chevron-back" onPress={onBack} label="Back to inbox" />
        <Pressable style={styles.identity} onPress={() => Alert.alert(conversation.contact.name, [conversation.contact.company, conversation.contact.email, conversation.contact.phone, conversation.contact.notes].filter(Boolean).join("\n") || conversation.contact.handle)}>
          <Avatar name={conversation.contact.name} uri={api.assetUrl(conversation.contact.avatarUrl)} size={38} />
          <View style={styles.identityCopy}>
            <Text style={styles.name} numberOfLines={1}>{conversation.contact.name}</Text>
            <View style={styles.identityMeta}>
              <PlatformMark platform={conversation.platform} compact />
              <Text style={styles.handle} numberOfLines={1}>{conversation.account?.label || conversation.contact.handle}</Text>
            </View>
          </View>
        </Pressable>
        <IconButton name={conversation.priority ? "flash" : "flash-outline"} active={conversation.priority} onPress={() => patch({ priority: !conversation.priority })} label="Toggle priority" />
      </View>

      <View style={styles.actionBar}>
        <Pressable onPress={() => patch({ status: conversation.status === "done" ? "open" : "done" })} style={[styles.action, conversation.status === "done" && styles.actionActive]}>
          <NativeIcon name={conversation.status === "done" ? "checkmark-circle" : "checkmark-circle-outline"} size={17} color={conversation.status === "done" ? colors.success : colors.muted} />
          <Text style={[styles.actionText, conversation.status === "done" && styles.actionTextActive]}>{conversation.status === "done" ? "Done" : "Mark done"}</Text>
        </Pressable>
        <View style={styles.actionDivider} />
        <Pressable onPress={() => patch({ todo: !conversation.todo })} style={[styles.action, conversation.todo && styles.actionActive]}>
          <NativeIcon name={conversation.todo ? "checkbox" : "checkbox-outline"} size={17} color={conversation.todo ? colors.accent : colors.muted} />
          <Text style={[styles.actionText, conversation.todo && { color: colors.info }]}>Task</Text>
        </Pressable>
        <View style={styles.actionDivider} />
        <Pressable onPress={() => patch({ status: conversation.status === "waiting" ? "open" : "waiting" })} style={[styles.action, conversation.status === "waiting" && styles.actionActive]}>
          <NativeIcon name="time-outline" size={17} color={conversation.status === "waiting" ? colors.warning : colors.muted} />
          <Text style={[styles.actionText, conversation.status === "waiting" && { color: colors.warning }]}>Waiting</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(false)} tintColor={colors.accent} />}
        contentContainerStyle={[styles.messages, !messages.length && styles.messagesEmpty]}
        onContentSizeChange={() => { if (loading) listRef.current?.scrollToEnd({ animated: false }); }}
        ListEmptyComponent={loading ? <Text style={styles.emptyText}>Loading messages…</Text> : <Text style={styles.emptyText}>No messages in this conversation yet.</Text>}
        renderItem={({ item, index }) => {
          const own = item.direction === "out";
          const previous = messages[index - 1];
          const showTime = !previous || previous.direction !== item.direction || new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() > 10 * 60_000;
          const mediaUri = api.assetUrl(item.mediaUrl);
          return (
            <View style={[styles.messageWrap, own ? styles.messageOwnWrap : styles.messageTheirWrap]}>
              {showTime ? <Text style={styles.messageTime}>{timeAgo(item.createdAt)}</Text> : null}
              {item.senderName && !own ? <Text style={styles.sender}>{item.senderName}</Text> : null}
              <Pressable
                disabled={!mediaUri}
                onPress={() => mediaUri && Linking.openURL(mediaUri)}
                style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleTheir, item.deliveryStatus === "failed" && styles.bubbleFailed]}
              >
                {mediaUri && item.mediaType === "image" ? <Image source={{ uri: mediaUri }} style={styles.media} resizeMode="cover" /> : null}
                {mediaUri && item.mediaType && item.mediaType !== "image" ? (
                  <View style={styles.fileRow}>
                    <NativeIcon name={item.mediaType === "audio" ? "mic" : item.mediaType === "video" ? "videocam" : "document"} size={21} color={own ? colors.white : colors.accent} />
                    <Text style={[styles.fileName, own && styles.messageOwnText]} numberOfLines={2}>{item.mediaName || item.mediaType}</Text>
                  </View>
                ) : null}
                {item.body ? <Text selectable style={[styles.messageText, own && styles.messageOwnText]}>{item.body}</Text> : null}
                {item.reactions?.length ? (
                  <View style={styles.reactions}>{item.reactions.map((reaction) => <Text key={reaction.emoji} style={styles.reaction}>{reaction.emoji} {reaction.count}</Text>)}</View>
                ) : null}
                {own && item.deliveryStatus ? (
                  <View style={styles.deliveryRow}>
                    <NativeIcon name={item.deliveryStatus === "failed" ? "alert-circle" : item.deliveryStatus === "sending" || item.deliveryStatus === "pending" ? "time-outline" : "checkmark-done"} size={12} color={item.deliveryStatus === "failed" ? colors.danger : "#DCEBFF"} />
                    {item.deliveryStatus === "failed" ? <Text style={styles.deliveryFailed}>Not sent</Text> : null}
                  </View>
                ) : null}
              </Pressable>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <Pressable disabled={sending} onPress={attachmentMenu} style={styles.attach}>
          <NativeIcon name="add" size={24} color={colors.accent} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${conversation.contact.name}`}
          placeholderTextColor={colors.subtle}
          selectionColor={colors.accent}
          multiline
          maxLength={10_000}
          style={styles.input}
        />
        <Pressable disabled={!draft.trim() || sending} onPress={sendText} style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]}>
          <NativeIcon name="arrow-up" size={18} color={colors.white} weight="bold" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, paddingBottom: 7 },
  identity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  identityMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  handle: { color: colors.muted, fontSize: 11, flex: 1 },
  actionBar: { height: 40, backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  action: { flex: 1, height: "100%", flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center" },
  actionActive: { backgroundColor: colors.surface },
  actionText: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  actionTextActive: { color: colors.success },
  actionDivider: { width: StyleSheet.hairlineWidth, height: 19, backgroundColor: colors.border },
  messages: { paddingHorizontal: 13, paddingTop: 18, paddingBottom: 14 },
  messagesEmpty: { flexGrow: 1, justifyContent: "center" },
  emptyText: { color: colors.subtle, textAlign: "center", fontSize: 13 },
  messageWrap: { maxWidth: "86%", marginBottom: 5 },
  messageOwnWrap: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageTheirWrap: { alignSelf: "flex-start", alignItems: "flex-start" },
  messageTime: { color: colors.subtle, fontSize: 9, marginHorizontal: 8, marginBottom: 4, marginTop: 7 },
  sender: { color: colors.muted, fontSize: 10, marginLeft: 8, marginBottom: 3 },
  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, minWidth: 42, overflow: "hidden" },
  bubbleOwn: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  bubbleTheir: { backgroundColor: colors.elevated, borderBottomLeftRadius: 5 },
  bubbleFailed: { backgroundColor: "#592C2C", borderColor: colors.danger },
  messageText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  messageOwnText: { color: colors.white },
  media: { width: 230, height: 180, borderRadius: 11, marginHorizontal: -7, marginTop: -3, marginBottom: 7, backgroundColor: colors.surface },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 230 },
  fileName: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  reaction: { color: colors.text, fontSize: 11, backgroundColor: `${colors.white}12`, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  deliveryRow: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3, marginBottom: -3 },
  deliveryFailed: { color: colors.danger, fontSize: 10, fontWeight: "600" },
  composer: { minHeight: 61, maxHeight: 150, paddingHorizontal: 8, paddingTop: 7, paddingBottom: 8, flexDirection: "row", alignItems: "flex-end", gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, backgroundColor: colors.surface },
  attach: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 38, maxHeight: 120, borderRadius: 19, backgroundColor: colors.elevated, color: colors.text, fontSize: 16, lineHeight: 20, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 8 },
  send: { width: 34, height: 34, borderRadius: 17, marginBottom: 2, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendDisabled: { backgroundColor: colors.subtle, opacity: 0.5 },
});
