import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import React, { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { OmniApi } from "../api";
import { colors, platformNames, sentenceCase, timeAgo } from "../theme";
import type { Account, Automation, HealthResponse } from "../types";
import { PageHeader, Pill, PlatformMark, SecondaryButton } from "../components/ui";
import { NativeIcon } from "../components/NativeIcon";

export function MoreScreen({
  api,
  serverUrl,
  health,
  demo,
  biometricEnabled,
  onBiometricChange,
  onDisconnect,
}: {
  api: OmniApi;
  serverUrl: string;
  health: HealthResponse | null;
  demo: boolean;
  biometricEnabled: boolean;
  onBiometricChange: (enabled: boolean) => Promise<void>;
  onDisconnect: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [nextAccounts, nextAutomations] = await Promise.all([api.accounts(), api.automations()]);
      setAccounts(nextAccounts);
      setAutomations(nextAutomations);
    } catch (error) {
      Alert.alert("Workspace details unavailable", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [api]);

  async function toggleAutomation(automation: Automation) {
    const enabled = !automation.enabled;
    setAutomations((current) => current.map((item) => item.id === automation.id ? { ...item, enabled } : item));
    try {
      const updated = await api.updateAutomation(automation.id, { enabled });
      setAutomations((current) => current.map((item) => item.id === automation.id ? updated : item));
    } catch (error) {
      setAutomations((current) => current.map((item) => item.id === automation.id ? automation : item));
      Alert.alert("Automation not updated", error instanceof Error ? error.message : "Try again.");
    }
  }

  function confirmRun(automation: Automation) {
    Alert.alert(
      `Run “${automation.name}”?`,
      `This can send messages to ${automation.matchCount} matching conversation${automation.matchCount === 1 ? "" : "s"}. Cooldown rules still apply.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Run now", onPress: async () => {
          try {
            const result = await api.runAutomation(automation.id);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("Automation finished", `${result.sent} sent · ${result.skipped} skipped · ${result.failed} failed`);
            load();
          } catch (error) {
            Alert.alert("Automation failed", error instanceof Error ? error.message : "Try again.");
          }
        } },
      ],
    );
  }

  async function changeBiometrics(enabled: boolean) {
    if (enabled) {
      const available = await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
      if (!available) {
        Alert.alert("Face ID unavailable", "Set up Face ID or a device passcode before enabling the app lock.");
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Enable Omni app lock", fallbackLabel: "Use passcode" });
      if (!result.success) return;
    }
    await onBiometricChange(enabled);
  }

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <PageHeader title="More" subtitle="Connections, automations, and security" />

      <View style={styles.serverCard}>
        <View style={styles.serverIcon}><NativeIcon name={demo ? "sparkles" : "lock-closed"} size={20} color={colors.accent} /></View>
        <View style={styles.serverCopy}>
          <View style={styles.serverTitleRow}>
            <Text style={styles.serverTitle}>{demo ? "Offline preview" : "Private server"}</Text>
            <View style={styles.onlineDot} />
          </View>
          <Text style={styles.serverUrl} numberOfLines={1}>{demo ? "Bundled sample workspace" : serverUrl}</Text>
          {health?.tailscaleUser?.login ? <Text style={styles.tailUser}>Connected as {health.tailscaleUser.login}</Text> : null}
        </View>
      </View>

      <SectionTitle title="Accounts" detail={loading ? "Checking…" : `${accounts.filter((item) => item.status === "connected").length}/${accounts.length} online`} />
      <View style={styles.section}>
        {accounts.map((account, index) => (
          <View key={account.id} style={[styles.row, index > 0 && styles.rowBorder]}>
            <PlatformMark platform={account.platform} compact />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{account.label || platformNames[account.platform]}</Text>
              <Text style={styles.rowDetail} numberOfLines={1}>{account.detail || `${account.driver || "native"}${account.proxyRegion ? ` · ${account.proxyRegion}` : ""}`}</Text>
            </View>
            <Pill color={account.status === "connected" ? colors.success : account.status === "error" ? colors.danger : colors.warning}>{account.status}</Pill>
          </View>
        ))}
        {!loading && !accounts.length ? <Text style={styles.sectionEmpty}>No channel accounts connected yet.</Text> : null}
      </View>

      <SectionTitle title="Automations" detail={`${automations.filter((item) => item.enabled).length} active`} />
      <View style={styles.section}>
        {automations.map((automation, index) => (
          <View key={automation.id} style={[styles.automation, index > 0 && styles.rowBorder]}>
            <View style={styles.automationTop}>
              <View style={[styles.automationIcon, automation.enabled && styles.automationIconActive]}>
                <NativeIcon name="flash" size={17} color={automation.enabled ? colors.warning : colors.subtle} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{automation.name}</Text>
                <Text style={styles.rowDetail}>{sentenceCase(automation.trigger)} · {sentenceCase(automation.schedule)} · {automation.matchCount} matches</Text>
              </View>
              <Switch value={automation.enabled} onValueChange={() => toggleAutomation(automation)} trackColor={{ false: colors.fill, true: colors.success }} thumbColor={colors.white} />
            </View>
            <View style={styles.automationFooter}>
              <Text style={styles.lastRun}>{automation.lastRunAt ? `Last run ${timeAgo(automation.lastRunAt)} ago` : "Never run"}</Text>
              <Pressable onPress={() => confirmRun(automation)} disabled={!automation.enabled} style={[styles.runButton, !automation.enabled && styles.disabled]}>
                <NativeIcon name="play" size={12} color={colors.accent} />
                <Text style={styles.runText}>Run now</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {!loading && !automations.length ? <Text style={styles.sectionEmpty}>No automations configured.</Text> : null}
      </View>

      <SectionTitle title="Security" />
      <View style={styles.section}>
        <View style={styles.row}>
          <View style={styles.settingIcon}><NativeIcon name="scan-outline" size={20} color={colors.accent} /></View>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>Face ID app lock</Text>
            <Text style={styles.rowDetail}>Protect cached conversations when reopening Omni.</Text>
          </View>
          <Switch value={biometricEnabled} onValueChange={changeBiometrics} trackColor={{ false: colors.fill, true: colors.success }} thumbColor={colors.white} />
        </View>
      </View>

      {!demo ? (
        <>
          <SectionTitle title="Advanced" />
          <Pressable onPress={() => Linking.openURL(serverUrl)} style={styles.dashboardButton}>
            <View style={styles.settingIcon}><NativeIcon name="desktop-outline" size={19} color={colors.info} /></View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Open full local dashboard</Text>
              <Text style={styles.rowDetail}>Channel login, imports, snippets, and admin tools.</Text>
            </View>
            <NativeIcon name="chevron-forward" size={14} color={colors.subtle} />
          </Pressable>
        </>
      ) : null}

      <SecondaryButton onPress={onDisconnect} icon={demo ? "close-circle-outline" : "unlink-outline"} danger style={styles.disconnect}>
        {demo ? "Exit preview" : "Forget this server"}
      </SecondaryButton>
      <Text style={styles.footer}>Omni CRM for iOS · Data stays on your private server</Text>
    </ScrollView>
  );
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 120 },
  serverCard: { marginHorizontal: 16, marginBottom: 22, borderRadius: 12, backgroundColor: colors.surface, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  serverIcon: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated },
  serverCopy: { flex: 1, minWidth: 0 },
  serverTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  serverTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  serverUrl: { color: colors.muted, fontSize: 12, marginTop: 4 },
  tailUser: { color: colors.success, fontSize: 11, marginTop: 3 },
  sectionTitleRow: { marginHorizontal: 20, marginTop: 3, marginBottom: 7, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: colors.muted, fontSize: 13 },
  sectionDetail: { color: colors.subtle, fontSize: 12 },
  section: { marginHorizontal: 16, marginBottom: 22, borderRadius: 12, backgroundColor: colors.surface, overflow: "hidden" },
  row: { minHeight: 64, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, marginLeft: 13 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "500" },
  rowDetail: { color: colors.muted, fontSize: 12, marginTop: 4 },
  sectionEmpty: { color: colors.subtle, fontSize: 12, padding: 17, textAlign: "center" },
  automation: { paddingHorizontal: 13, paddingVertical: 12 },
  automationTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  automationIcon: { width: 37, height: 37, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated },
  automationIconActive: { backgroundColor: colors.fill },
  automationFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginLeft: 47, marginTop: 9 },
  lastRun: { color: colors.subtle, fontSize: 10 },
  runButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 5, paddingVertical: 6 },
  runText: { color: colors.accent, fontSize: 12, fontWeight: "500" },
  settingIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  dashboardButton: { minHeight: 67, marginHorizontal: 16, marginBottom: 22, borderRadius: 12, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 10 },
  disconnect: { marginHorizontal: 16, marginTop: 4 },
  disabled: { opacity: 0.4 },
  footer: { color: colors.subtle, fontSize: 10, textAlign: "center", marginTop: 15 },
});
