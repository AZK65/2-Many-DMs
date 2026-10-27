import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import type { OmniApi } from "../api";
import { readCache, writeCache } from "../storage";
import { colors, timeAgo } from "../theme";
import type { Conversation, TodoTask } from "../types";
import { Avatar, EmptyState, LoadingState, PageHeader, Segmented } from "../components/ui";
import { NativeIcon } from "../components/NativeIcon";

type TodoView = "open" | "done";

export function TodosScreen({
  api,
  conversations,
  onOpen,
  onConversationPatch,
}: {
  api: OmniApi;
  conversations: Conversation[];
  onOpen: (conversation: Conversation) => void;
  onConversationPatch: (id: string, patch: Partial<Conversation>) => Promise<void>;
}) {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [view, setView] = useState<TodoView>("open");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const result = await api.todos();
      setTasks(result);
      await writeCache("todos", result);
    } catch (error) {
      if (!tasks.length) Alert.alert("Tasks unavailable", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    readCache<TodoTask[]>("todos").then((cached) => cached?.length && setTasks(cached));
    load();
  }, [api]);

  const conversationTasks = conversations.filter((item) => item.todo && (view === "done" ? item.todoCompleted : !item.todoCompleted));
  const standalone = useMemo(() => tasks.filter((item) => view === "done" ? item.completed : !item.completed), [tasks, view]);

  async function create() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    try {
      const saved = await api.createTodo(title);
      setTasks((current) => [saved, ...current]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setDraft(title);
      Alert.alert("Task not created", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function toggleTask(task: TodoTask) {
    const completed = !task.completed;
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed } : item));
    try {
      await api.updateTodo(task.id, { completed });
      await Haptics.selectionAsync();
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      Alert.alert("Task not updated", error instanceof Error ? error.message : "Try again.");
    }
  }

  function taskActions(task: TodoTask) {
    Alert.alert(task.title, undefined, [
      { text: task.priority ? "Remove priority" : "Mark priority", onPress: async () => { const updated = await api.updateTodo(task.id, { priority: !task.priority }); setTasks((current) => current.map((item) => item.id === task.id ? updated : item)); } },
      { text: "Delete", style: "destructive", onPress: async () => { await api.deleteTodo(task.id); setTasks((current) => current.filter((item) => item.id !== task.id)); } },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  if (loading && !tasks.length && !conversationTasks.length) return <LoadingState label="Loading tasks…" />;
  const data = [
    ...conversationTasks.map((conversation) => ({ kind: "conversation" as const, id: `conversation-${conversation.id}`, conversation })),
    ...standalone.map((task) => ({ kind: "task" as const, id: `task-${task.id}`, task })),
  ];

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <PageHeader title="Tasks" subtitle="Follow-ups and standalone work" />
      <View style={styles.createRow}>
        <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={create} returnKeyType="done" placeholder="Add a task…" placeholderTextColor={colors.subtle} selectionColor={colors.accent} style={styles.input} />
        <Pressable onPress={create} disabled={!draft.trim()} style={[styles.addButton, !draft.trim() && styles.disabled]}>
          <NativeIcon name="add" size={20} color={colors.white} weight="semibold" />
        </Pressable>
      </View>
      <Segmented value={view} onChange={setView} options={[{ value: "open", label: "Open", count: tasks.filter((item) => !item.completed).length + conversations.filter((item) => item.todo && !item.todoCompleted).length }, { value: "done", label: "Completed", count: tasks.filter((item) => item.completed).length + conversations.filter((item) => item.todo && item.todoCompleted).length }]} />
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.accent} />}
        contentContainerStyle={data.length ? styles.list : styles.emptyList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<EmptyState icon="checkmark-done" title={view === "open" ? "All clear" : "Nothing completed yet"} body={view === "open" ? "Add a task above or save a conversation to your task list." : "Completed work will collect here."} />}
        renderItem={({ item }) => item.kind === "conversation" ? (
          <Pressable onPress={() => onOpen(item.conversation)} style={styles.row}>
            <Pressable hitSlop={10} onPress={() => onConversationPatch(item.conversation.id, { todoCompleted: !item.conversation.todoCompleted })} style={styles.check}>
              <NativeIcon name={item.conversation.todoCompleted ? "checkmark-circle" : "ellipse-outline"} size={24} color={item.conversation.todoCompleted ? colors.accent : colors.muted} />
            </Pressable>
            <Avatar name={item.conversation.contact.name} uri={api.assetUrl(item.conversation.contact.avatarUrl)} size={39} />
            <View style={styles.rowCopy}>
              <Text style={[styles.taskTitle, item.conversation.todoCompleted && styles.done]} numberOfLines={2}>{item.conversation.todoNote || `Follow up with ${item.conversation.contact.name}`}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.conversation.contact.name} · {item.conversation.platform}</Text>
            </View>
            {item.conversation.priority ? <NativeIcon name="flash" size={16} color={colors.warning} /> : null}
          </Pressable>
        ) : (
          <Pressable onLongPress={() => taskActions(item.task)} style={styles.row}>
            <Pressable hitSlop={10} onPress={() => toggleTask(item.task)} style={styles.check}>
              <NativeIcon name={item.task.completed ? "checkmark-circle" : "ellipse-outline"} size={24} color={item.task.completed ? colors.accent : colors.muted} />
            </Pressable>
            <View style={styles.rowCopy}>
              <Text style={[styles.taskTitle, item.task.completed && styles.done]} numberOfLines={2}>{item.task.title}</Text>
              <Text style={styles.meta}>{item.task.note || `Added ${timeAgo(item.task.createdAt)} ago`}</Text>
            </View>
            {item.task.priority ? <NativeIcon name="flash" size={16} color={colors.warning} /> : null}
          </Pressable>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  createRow: { height: 42, marginHorizontal: 16, flexDirection: "row", gap: 8 },
  input: { flex: 1, borderRadius: 10, backgroundColor: colors.elevated, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  addButton: { width: 42, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
  list: { paddingBottom: 100 },
  emptyList: { flexGrow: 1, paddingBottom: 100 },
  row: { minHeight: 67, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: 55 },
  check: { width: 29, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  taskTitle: { color: colors.text, fontSize: 16, fontWeight: "500", lineHeight: 21 },
  done: { color: colors.subtle, textDecorationLine: "line-through" },
  meta: { color: colors.subtle, fontSize: 11, marginTop: 4 },
});
