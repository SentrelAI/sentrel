import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api, ApiError } from "../../../../src/lib/api";
import { useAuth } from "../../../../src/lib/auth";
import type { Agent, Spend } from "../../../../src/lib/types";
import { Button, Card, Pill, StatusDot } from "../../../../src/components/ui";
import { colors } from "../../../../src/theme/colors";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

function CapBar({ spent, cap }: { spent: number; cap: number | null }) {
  if (!cap) return null;
  const pct = Math.min(1, spent / cap);
  const over = spent >= cap;
  const color = over ? colors.danger : pct >= 0.8 ? colors.warning : colors.primary;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 999, overflow: "hidden" }}>
        <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: color }} />
      </View>
    </View>
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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function confirmDelete() {
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
            router.replace("/agents");
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
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.textMuted }}>Loading…</Text>
      </View>
    );
  }

  const overDaily = spend?.daily_cap_usd != null && spend.today_usd >= spend.daily_cap_usd;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.textMuted} />
      }
    >
      <Stack.Screen options={{ title: agent.name }} />

      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <StatusDot status={agent.status} />
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>{agent.name}</Text>
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 15, marginBottom: 16 }}>{agent.role}</Text>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <Pill label={agent.status} tone={agent.status === "running" ? "success" : "muted"} />
        {agent.ai_config?.model_id ? <Pill label={agent.ai_config.model_id} tone="primary" /> : null}
        {agent.instance?.region ? <Pill label={agent.instance.region} /> : null}
      </View>

      {/* Primary actions */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
        <Button title="Chat" onPress={() => router.push(`/agents/${id}/chat`)} style={{ flex: 1 }} />
        <Button title="Edit" variant="secondary" onPress={() => router.push(`/agents/${id}/edit`)} style={{ flex: 1 }} />
      </View>

      {/* Spend */}
      <Card style={{ marginBottom: 16 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 4 }}>Spend</Text>
        {overDaily ? (
          <View style={{ marginBottom: 8 }}>
            <Pill label="Daily cap reached" tone="danger" />
          </View>
        ) : null}

        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.textMuted }}>Today</Text>
            <Text style={{ color: colors.text, fontWeight: "600" }}>
              {money(spend?.today_usd)} <Text style={{ color: colors.textFaint }}>/ {money(spend?.daily_cap_usd)}</Text>
            </Text>
          </View>
          <CapBar spent={spend?.today_usd || 0} cap={spend?.daily_cap_usd ?? null} />
        </View>

        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.textMuted }}>This month (30d)</Text>
            <Text style={{ color: colors.text, fontWeight: "600" }}>
              {money(spend?.thirty_day_usd)} <Text style={{ color: colors.textFaint }}>/ {money(spend?.monthly_cap_usd)}</Text>
            </Text>
          </View>
          <CapBar spent={spend?.thirty_day_usd || 0} cap={spend?.monthly_cap_usd ?? null} />
        </View>

        <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 14 }}>
          {spend?.runs_today ?? 0} runs today
        </Text>
      </Card>

      {/* Machine */}
      <Card style={{ marginBottom: 16 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 10 }}>Machine</Text>
        <KV k="Instance" v={agent.instance?.status || "not provisioned"} />
        {agent.instance?.machine_id ? <KV k="Machine ID" v={agent.instance.machine_id} /> : null}
        {agent.instance?.public_ip ? <KV k="IP" v={agent.instance.public_ip} /> : null}
        {agent.instance?.provisioning_error ? (
          <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>
            {agent.instance.provisioning_error}
          </Text>
        ) : null}
        <Pressable onPress={() => router.push(`/agents/${id}/ops`)} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Operations →</Text>
        </Pressable>
      </Card>

      <Button title="Delete agent" variant="danger" onPress={confirmDelete} loading={busy} />
    </ScrollView>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: colors.textMuted }}>{k}</Text>
      <Text style={{ color: colors.text, maxWidth: "60%", textAlign: "right" }} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}
