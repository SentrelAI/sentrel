import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { api, ApiError } from "../../../../src/lib/api";
import { useAuth } from "../../../../src/lib/auth";
import type { OpsResult } from "../../../../src/lib/types";
import { Button, Card } from "../../../../src/components/ui";
import { colors } from "../../../../src/theme/colors";

type Action = "restart" | "reload" | "redeploy" | "reprovision";

const ACTIONS: { key: Action; label: string; variant?: "secondary" | "danger"; confirm?: string }[] = [
  { key: "restart", label: "Restart", variant: "secondary" },
  { key: "reload", label: "Reload config", variant: "secondary" },
  { key: "redeploy", label: "Redeploy", variant: "secondary" },
  {
    key: "reprovision",
    label: "Reprovision (destroy + recreate)",
    variant: "danger",
    confirm: "This destroys the machine and volume, then recreates from scratch. Continue?",
  },
];

export default function Ops() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [busy, setBusy] = useState<Action | null>(null);
  const [logs, setLogs] = useState<OpsResult["logs"]>([]);
  const [logError, setLogError] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!token || !id) return;
    setLoadingLogs(true);
    setLogError(null);
    try {
      const res = await api.logs(token, id, 200);
      if (res.ok) setLogs(res.logs || []);
      else setLogError(res.message || "No logs available");
    } catch (e) {
      setLogError(e instanceof ApiError ? e.message : "Failed to fetch logs");
    } finally {
      setLoadingLogs(false);
    }
  }, [token, id]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  async function run(action: Action, confirm?: string) {
    if (!token || !id) return;
    const exec = async () => {
      setBusy(action);
      try {
        const res = await api.op(token, id, action);
        Alert.alert(res.ok ? "Done" : "Failed", res.message || (res.ok ? "Requested" : "Operation failed"));
        if (res.ok) setTimeout(loadLogs, 1500);
      } catch (e) {
        Alert.alert("Error", e instanceof ApiError ? e.message : "Operation failed");
      } finally {
        setBusy(null);
      }
    };
    if (confirm) {
      Alert.alert("Confirm", confirm, [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", style: "destructive", onPress: exec },
      ]);
    } else {
      exec();
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Card style={{ marginBottom: 16 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Machine actions</Text>
        {ACTIONS.map((a) => (
          <View key={a.key} style={{ marginBottom: 10 }}>
            <Button
              title={a.label}
              variant={a.variant}
              loading={busy === a.key}
              disabled={busy !== null && busy !== a.key}
              onPress={() => run(a.key, a.confirm)}
            />
          </View>
        ))}
      </Card>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Logs</Text>
        <Button title="Refresh" variant="ghost" onPress={loadLogs} loading={loadingLogs} style={{ height: 32, paddingHorizontal: 8 }} />
      </View>

      <Card style={{ backgroundColor: "#08080C" }}>
        {logError ? (
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{logError}</Text>
        ) : logs && logs.length > 0 ? (
          logs.map((l, i) => (
            <Text
              key={i}
              style={{
                color: l.level === "error" ? colors.danger : colors.textMuted,
                fontFamily: "Courier",
                fontSize: 11,
                marginBottom: 3,
              }}
            >
              {l.timestamp ? `${l.timestamp.slice(11, 19)} ` : ""}
              {l.message}
            </Text>
          ))
        ) : (
          <Text style={{ color: colors.textFaint, fontSize: 13 }}>No log lines yet.</Text>
        )}
      </Card>
    </ScrollView>
  );
}
