import { BlurView } from "expo-blur";
import * as LocalAuthentication from "expo-local-authentication";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState as NativeAppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { OmniApi } from "./src/api";
import { PrimaryButton } from "./src/components/ui";
import { NativeIcon, type NativeIconName } from "./src/components/NativeIcon";
import { DemoApi } from "./src/demo";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ConnectionScreen } from "./src/screens/ConnectionScreen";
import { InboxScreen } from "./src/screens/InboxScreen";
import { ListeningScreen } from "./src/screens/ListeningScreen";
import { MoreScreen } from "./src/screens/MoreScreen";
import { PipelineScreen } from "./src/screens/PipelineScreen";
import { TodosScreen } from "./src/screens/TodosScreen";
import { clearCache, forgetServerUrl, loadServerUrl, readCache, saveServerUrl, writeCache } from "./src/storage";
import { colors } from "./src/theme";
import type { Conversation, HealthResponse } from "./src/types";

type Tab = "inbox" | "pipeline" | "tasks" | "listening" | "more";

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppRoot />
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [booting, setBooting] = useState(true);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const authenticating = useRef(false);
  const previousAppState = useRef<AppStateStatus>(NativeAppState.currentState);

  useEffect(() => {
    Promise.all([loadServerUrl(), readCache<boolean>("biometric-enabled")]).then(([savedUrl, biometric]) => {
      setServerUrl(savedUrl);
      setBiometricEnabled(Boolean(biometric));
      setLocked(Boolean(savedUrl && biometric));
      setBooting(false);
    });
  }, []);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Omni CRM",
        fallbackLabel: "Use passcode",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    if (locked && biometricEnabled) unlock();
  }, [locked, biometricEnabled, unlock]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (nextState) => {
      if (biometricEnabled && previousAppState.current === "background" && nextState === "active") setLocked(true);
      previousAppState.current = nextState;
    });
    return () => subscription.remove();
  }, [biometricEnabled]);

  async function connected(url: string, response: HealthResponse) {
    await saveServerUrl(url);
    setHealth(response);
    setServerUrl(url);
    setDemo(false);
  }

  async function disconnect() {
    if (!demo) await forgetServerUrl();
    await clearCache();
    setServerUrl(null);
    setHealth(null);
    setDemo(false);
  }

  async function changeBiometrics(enabled: boolean) {
    setBiometricEnabled(enabled);
    await writeCache("biometric-enabled", enabled);
  }

  if (booting) return <View style={styles.boot}><NativeIcon name="chatbubbles" size={42} color={colors.accent} weight="semibold" /><Text style={styles.bootText}>Omni</Text></View>;
  if (!serverUrl && !demo) return <ConnectionScreen onConnected={connected} onDemo={() => { setDemo(true); setHealth(null); }} />;
  if (locked && biometricEnabled) return <LockScreen onUnlock={unlock} />;

  return (
    <Workspace
      key={demo ? "demo" : serverUrl!}
      api={demo ? new DemoApi() : new OmniApi(serverUrl!)}
      serverUrl={demo ? "demo://omni" : serverUrl!}
      initialHealth={health}
      demo={demo}
      biometricEnabled={biometricEnabled}
      onBiometricChange={changeBiometrics}
      onDisconnect={disconnect}
    />
  );
}

function Workspace({
  api,
  serverUrl,
  initialHealth,
  demo,
  biometricEnabled,
  onBiometricChange,
  onDisconnect,
}: {
  api: OmniApi;
  serverUrl: string;
  initialHealth: HealthResponse | null;
  demo: boolean;
  biometricEnabled: boolean;
  onBiometricChange: (enabled: boolean) => Promise<void>;
  onDisconnect: () => void;
}) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(initialHealth);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [nextConversations, nextHealth] = await Promise.all([api.conversations(), api.health()]);
      setConversations(nextConversations);
      setHealth(nextHealth);
      setOffline(false);
      await writeCache("conversations", nextConversations);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    readCache<Conversation[]>("conversations").then((cached) => {
      if (alive && cached?.length) {
        setConversations(cached);
        setLoading(false);
      }
    });
    refresh();
    const poll = setInterval(() => refresh(true), 15_000);
    const appState = NativeAppState.addEventListener("change", (state) => { if (state === "active") refresh(true); });
    return () => { alive = false; clearInterval(poll); appState.remove(); };
  }, [refresh]);

  async function patchConversation(id: string, patch: Partial<Conversation>) {
    const previous = conversations;
    const next = conversations.map((item) => item.id === id ? { ...item, ...patch } : item);
    setConversations(next);
    try {
      await api.updateConversation(id, patch);
      await writeCache("conversations", next);
    } catch (error) {
      setConversations(previous);
      throw error;
    }
  }

  const selected = useMemo(() => conversations.find((item) => item.id === selectedId) || null, [conversations, selectedId]);
  const unread = conversations.reduce((sum, item) => sum + item.unread, 0);

  if (selected) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <ChatScreen api={api} conversation={selected} onBack={() => { setSelectedId(null); refresh(true); }} onPatch={(patch) => patchConversation(selected.id, patch)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.workspace}>
        {tab === "inbox" ? <InboxScreen api={api} conversations={conversations} loading={loading} refreshing={refreshing} offline={offline} onRefresh={() => refresh()} onOpen={(item) => setSelectedId(item.id)} onUpdate={patchConversation} /> : null}
        {tab === "pipeline" ? <PipelineScreen api={api} conversations={conversations} onOpen={(item) => setSelectedId(item.id)} /> : null}
        {tab === "tasks" ? <TodosScreen api={api} conversations={conversations} onOpen={(item) => setSelectedId(item.id)} onConversationPatch={patchConversation} /> : null}
        {tab === "listening" ? <ListeningScreen api={api} /> : null}
        {tab === "more" ? <MoreScreen api={api} serverUrl={serverUrl} health={health} demo={demo} biometricEnabled={biometricEnabled} onBiometricChange={onBiometricChange} onDisconnect={onDisconnect} /> : null}
        <TabBar value={tab} onChange={setTab} unread={unread} />
      </View>
    </SafeAreaView>
  );
}

function TabBar({ value, onChange, unread }: { value: Tab; onChange: (tab: Tab) => void; unread: number }) {
  const insets = useSafeAreaInsets();
  const tabs: { id: Tab; label: string; icon: NativeIconName; selectedIcon: NativeIconName }[] = [
    { id: "inbox", label: "Inbox", icon: "chatbubbles-outline", selectedIcon: "chatbubbles" },
    { id: "pipeline", label: "Pipeline", icon: "layers-outline", selectedIcon: "layers" },
    { id: "tasks", label: "Tasks", icon: "checkbox-outline", selectedIcon: "checkbox" },
    { id: "listening", label: "Listening", icon: "radio-outline", selectedIcon: "radio" },
    { id: "more", label: "More", icon: "grid-outline", selectedIcon: "grid" },
  ];
  return (
    <View style={[styles.tabBar, { height: 50 + insets.bottom, paddingBottom: insets.bottom }]}>
      <BlurView intensity={88} tint="systemChromeMaterialDark" style={StyleSheet.absoluteFill} />
      {tabs.map((item) => {
        const selected = item.id === value;
        return (
          <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(item.id)} style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}>
            <View>
              <NativeIcon name={selected ? item.selectedIcon : item.icon} size={22} color={selected ? colors.accent : colors.muted} weight={selected ? "semibold" : "regular"} />
              {item.id === "inbox" && unread > 0 ? <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{unread > 9 ? "9+" : unread}</Text></View> : null}
            </View>
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  return (
    <View style={styles.lock}>
      <NativeIcon name="lock-closed" size={44} color={colors.muted} weight="regular" />
      <Text style={styles.lockTitle}>Omni is locked</Text>
      <Text style={styles.lockBody}>Use Face ID or your device passcode to open your private workspace.</Text>
      <PrimaryButton onPress={onUnlock} icon="scan-outline" style={styles.unlockButton}>Unlock Omni</PrimaryButton>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  workspace: { flex: 1 },
  boot: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  bootText: { color: colors.text, fontSize: 17, fontWeight: "600", marginTop: 13 },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, overflow: "hidden", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, flexDirection: "row" },
  tab: { flex: 1, alignItems: "center", gap: 1, paddingTop: 5 },
  tabPressed: { opacity: 0.55 },
  tabLabel: { color: colors.muted, fontSize: 10, fontWeight: "500" },
  tabLabelSelected: { color: colors.accent },
  tabBadge: { position: "absolute", top: -5, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  tabBadgeText: { color: colors.white, fontSize: 9, fontWeight: "700" },
  lock: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 34 },
  lockTitle: { color: colors.text, fontSize: 24, fontWeight: "700", marginTop: 20 },
  lockBody: { color: colors.muted, textAlign: "center", fontSize: 15, lineHeight: 21, marginTop: 8, maxWidth: 310 },
  unlockButton: { alignSelf: "stretch", marginTop: 24 },
});
