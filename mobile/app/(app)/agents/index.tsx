import { Link, Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { api, ApiError } from "../../../src/lib/api";
import { useAuth } from "../../../src/lib/auth";
import type { AgentSummary } from "../../../src/lib/types";
import { Pill, StatusDot } from "../../../src/components/ui";
import { colors } from "../../../src/theme/colors";

export default function AgentsList() {
  const { token } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { agents } = await api.listAgents(token);
      setAgents(agents);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load agents");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  // Reload whenever the screen regains focus (e.g. after creating an agent).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push("/agents/new")} hitSlop={12}>
              <Text style={{ color: colors.primary, fontSize: 28, fontWeight: "400" }}>＋</Text>
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.push("/settings")} hitSlop={12}>
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>Settings</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={agents}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.textMuted}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: "center", paddingTop: 80, paddingHorizontal: 24 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
                {error ? "Couldn’t load agents" : "No agents yet"}
              </Text>
              <Text style={{ color: colors.textMuted, textAlign: "center", marginBottom: 20 }}>
                {error || "Create your first AI employee to get started."}
              </Text>
              <Pressable
                onPress={() => (error ? load() : router.push("/agents/new"))}
                style={{ backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 }}
              >
                <Text style={{ color: colors.primaryText, fontWeight: "600" }}>
                  {error ? "Retry" : "Create agent"}
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Link href={`/agents/${item.id}`} asChild>
            <Pressable
              style={({ pressed }) => [
                {
                  backgroundColor: colors.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 16,
                  marginBottom: 12,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <StatusDot status={item.status} />
                    <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>
                      {item.name}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textMuted, marginTop: 4 }}>{item.role}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <Pill label={item.status} tone={item.status === "running" ? "success" : "muted"} />
                  {item.model_id ? (
                    <Text style={{ color: colors.textFaint, fontSize: 11 }}>{item.model_id}</Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}
