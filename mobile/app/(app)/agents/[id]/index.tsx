import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Avatar } from "../../../../src/components/Avatar";
import { api, ApiError } from "../../../../src/lib/api";
import { useAuth } from "../../../../src/lib/auth";
import type { Agent, Spend } from "../../../../src/lib/types";
import { colors, fonts, radius } from "../../../../src/theme/colors";

function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${Number(n).toFixed(2)}`;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.outlineVariant + "66", padding: 16, marginBottom: 14 }}>
      {title ? <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 16, marginBottom: 10 }}>{title}</Text> : null}
      {children}
    </View>
  );
}

function CapBar({ spent, cap }: { spent: number; cap: number | null }) {
  if (!cap) return null;
  const pct = Math.min(1, spent / cap);
  const color = spent >= cap ? colors.danger : pct >= 0.8 ? colors.warning : colors.secondary;
  return (
    <View style={{ marginTop: 8, height: 6, backgroundColor: colors.surfaceContainerHighest, borderRadius: 999, overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: color }} />
    </View>
  );
}

function ActionButton({ icon, label, onPress, primary, danger, loading }: { icon: any; label: string; onPress: () => void; primary?: boolean; danger?: boolean; loading?: boolean }) {
  const bg = primary ? colors.secondary : "transparent";
  const fg = primary ? "#fff" : danger ? colors.danger : colors.secondary;
  const borderColor = primary ? "transparent" : danger ? colors.danger : colors.outline;
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        { flex: 1, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: bg, borderWidth: primary ? 0 : 1, borderColor },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <MaterialIcons name={icon} size={18} color={fg} />}
      <Text style={{ color: fg, fontFamily: fonts.bold, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export default function AgentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const { agent, spend } = await api.getAgent(token, id);
      setAgent(agent);
      setSpend(spend);
    } catch (e) {
      Alert.alert("Error", e instanceof ApiError ? e.message : "Failed to load agent");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmDelete() {
    Alert.alert("Delete agent", `Permanently delete ${agent?.name}? This tears down its machine.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!token || !id) return;
          setBusy(true);
          try {
            await api.deleteAgent(token, id);
            router.replace("/chats");
          } catch (e) {
            Alert.alert("Error", e instanceof ApiError ? e.message : "Delete failed");
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (loading || !agent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surfaceBright, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  const running = agent.status === "running";
  const overDaily = spend?.daily_cap_usd != null && spend.today_usd >= spend.daily_cap_usd;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surfaceBright }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.textMuted} />}
    >
      <Stack.Screen options={{ title: agent.name }} />

      {/* Hero */}
      <View style={{ alignItems: "center", paddingVertical: 12 }}>
        <View style={{ width: 80, height: 80 }}>
          <Avatar name={agent.name} size={80} />
          <View style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.status[agent.status] || colors.textMuted, borderWidth: 3, borderColor: colors.surfaceBright }} />
        </View>
        <Text style={{ color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, marginTop: 12 }}>{agent.name}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 15, marginTop: 2 }}>{agent.role}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Chip label={agent.status} tone={running ? "success" : "muted"} />
          {agent.ai_config?.model_id ? <Chip label={agent.ai_config.model_id} tone="primary" /> : null}
          {agent.instance?.region ? <Chip label={agent.instance.region} tone="muted" /> : null}
        </View>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: 10, marginVertical: 16 }}>
        <ActionButton icon="chat-bubble-outline" label="Chat" primary onPress={() => router.push(`/agents/${id}/chat?name=${encodeURIComponent(agent.name)}`)} />
        <ActionButton icon="edit" label="Edit" onPress={() => router.push(`/agents/${id}/edit`)} />
      </View>

      {/* Spend */}
      <Card title="Spend">
        {overDaily ? (
          <View style={{ alignSelf: "flex-start", backgroundColor: colors.errorContainer, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginBottom: 10 }}>
            <Text style={{ color: colors.onErrorContainer, fontFamily: fonts.labelSemibold, fontSize: 11 }}>Daily cap reached</Text>
          </View>
        ) : null}
        <SpendRow label="Today" value={money(spend?.today_usd)} cap={money(spend?.daily_cap_usd)} />
        <CapBar spent={spend?.today_usd || 0} cap={spend?.daily_cap_usd ?? null} />
        <View style={{ height: 14 }} />
        <SpendRow label="This month (30d)" value={money(spend?.thirty_day_usd)} cap={money(spend?.monthly_cap_usd)} />
        <CapBar spent={spend?.thirty_day_usd || 0} cap={spend?.monthly_cap_usd ?? null} />
        <Text style={{ color: colors.textFaint, fontFamily: fonts.label, fontSize: 12, marginTop: 14 }}>{spend?.runs_today ?? 0} runs today</Text>
      </Card>

      {/* Machine */}
      <Card title="Machine">
        <KV k="Instance" v={agent.instance?.status || "not provisioned"} />
        {agent.instance?.machine_id ? <KV k="Machine ID" v={agent.instance.machine_id} /> : null}
        {agent.instance?.public_ip ? <KV k="IP" v={agent.instance.public_ip} /> : null}
        {agent.instance?.provisioning_error ? (
          <Text style={{ color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 6 }}>{agent.instance.provisioning_error}</Text>
        ) : null}
        <Pressable onPress={() => router.push(`/agents/${id}/ops`)} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 }}>
          <Text style={{ color: colors.secondary, fontFamily: fonts.bold }}>Operations</Text>
          <MaterialIcons name="arrow-forward" size={16} color={colors.secondary} />
        </Pressable>
      </Card>

      <ActionButton icon="delete-outline" label="Delete agent" danger onPress={confirmDelete} loading={busy} />
    </ScrollView>
  );
}

function Chip({ label, tone }: { label: string; tone: "success" | "primary" | "muted" }) {
  const map = {
    success: { bg: "#dcf3e6", fg: "#16794a" },
    primary: { bg: colors.secondaryFixed, fg: colors.secondary },
    muted: { bg: colors.surfaceContainerHigh, fg: colors.textMuted },
  }[tone];
  return (
    <View style={{ backgroundColor: map.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill }}>
      <Text style={{ color: map.fg, fontFamily: fonts.labelSemibold, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function SpendRow({ label, value, cap }: { label: string; value: string; cap: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.semibold }}>
        {value} <Text style={{ color: colors.textFaint, fontFamily: fonts.body }}>/ {cap}</Text>
      </Text>
    </View>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>{k}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.body, maxWidth: "60%", textAlign: "right" }} numberOfLines={1}>{v}</Text>
    </View>
  );
}
