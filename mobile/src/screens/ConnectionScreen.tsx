import React, { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OmniApi, normalizeServerUrl } from "../api";
import { NativeIcon } from "../components/NativeIcon";
import { PrimaryButton } from "../components/ui";
import { colors } from "../theme";
import type { HealthResponse } from "../types";

export function ConnectionScreen({ initialUrl = "", onConnected, onDemo }: { initialUrl?: string; onConnected: (url: string, health: HealthResponse) => Promise<void>; onDemo: () => void }) {
  const [url, setUrl] = useState(initialUrl);
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      const normalized = normalizeServerUrl(url);
      const health = await new OmniApi(normalized).health();
      if (health.service !== "omni-crm") throw new Error("That address is not an Omni CRM server.");
      await onConnected(normalized, health);
    } catch (error) {
      Alert.alert("Couldn’t connect", error instanceof Error ? error.message : "Check the server address and try again.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <SafeAreaView style={styles.fill} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.appRow}><NativeIcon name="chatbubbles" size={25} color={colors.accent} weight="semibold" /><Text style={styles.appName}>Omni</Text></View>
          <Text style={styles.title}>Connect to Omni</Text>
          <Text style={styles.body}>Your conversations stay on your own computer. This iPhone connects privately through Tailscale.</Text>

          <Text style={styles.sectionLabel}>Before you connect</Text>
          <View style={styles.group}>
            <View style={styles.row}>
              <View style={styles.number}><Text style={styles.numberText}>1</Text></View>
              <View style={styles.rowCopy}><Text style={styles.rowTitle}>Join your Tailscale network</Text><Text style={styles.rowDetail}>Sign in on this iPhone with the same tailnet used by the Omni server.</Text></View>
            </View>
            <Pressable onPress={() => Linking.openURL("https://apps.apple.com/app/tailscale/id1470499037")} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
              <NativeIcon name="open-outline" size={20} color={colors.accent} /><Text style={styles.linkText}>Open Tailscale</Text><NativeIcon name="chevron-forward" size={14} color={colors.subtle} />
            </Pressable>
            <View style={styles.row}>
              <View style={styles.number}><Text style={styles.numberText}>2</Text></View>
              <View style={styles.rowCopy}><Text style={styles.rowTitle}>Copy your private address</Text><Text style={styles.rowDetail}>On the server, run “npm run mobile:serve” and copy the HTTPS address it prints.</Text></View>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Private server</Text>
          <View style={styles.group}>
            <View style={styles.inputRow}>
              <NativeIcon name="lock-closed" size={16} color={colors.muted} />
              <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://omni.tailnet.ts.net" placeholderTextColor={colors.subtle} selectionColor={colors.accent} returnKeyType="go" onSubmitEditing={connect} style={styles.input} />
            </View>
          </View>
          <Text style={styles.note}>Saved securely in this iPhone’s Keychain. The server is never exposed to the public internet.</Text>

          <PrimaryButton onPress={connect} disabled={connecting || !url.trim()}>
            {connecting ? "Connecting…" : "Connect"}
          </PrimaryButton>
          <Pressable onPress={onDemo} style={({ pressed }) => [styles.previewButton, pressed && styles.pressed]}>
            <Text style={styles.previewText}>Preview with sample data</Text>
          </Pressable>
          <Text style={styles.previewNote}>Offline preview for setup and App Review.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.grouped },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  appRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24 },
  appName: { color: colors.text, fontSize: 17, fontWeight: "600" },
  title: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.2 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 22, marginTop: 6, marginBottom: 28 },
  sectionLabel: { color: colors.muted, fontSize: 13, marginLeft: 16, marginBottom: 7, marginTop: 2 },
  group: { backgroundColor: colors.surface, borderRadius: 12, overflow: "hidden", marginBottom: 8 },
  row: { minHeight: 82, flexDirection: "row", paddingHorizontal: 16, paddingVertical: 14, gap: 12, alignItems: "flex-start" },
  number: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  numberText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  rowCopy: { flex: 1 }, rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600" }, rowDetail: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  linkRow: { minHeight: 48, marginLeft: 56, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  linkText: { color: colors.accent, fontSize: 16, flex: 1 },
  inputRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14 }, input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  note: { color: colors.subtle, fontSize: 12, lineHeight: 17, marginHorizontal: 16, marginBottom: 24 },
  previewButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 10 }, previewText: { color: colors.accent, fontSize: 16 }, previewNote: { color: colors.subtle, fontSize: 12, textAlign: "center" }, pressed: { opacity: 0.45 },
});
