import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Avatar } from "../../src/components/Avatar";
import { api, ApiError } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import type { ConversationSummary } from "../../src/lib/api";
import type { AgentSummary } from "../../src/lib/types";
import { colors, fonts } from "../../src/theme/colors";

function shortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface Row extends AgentSummary {
  preview: string;
  time: string | null;
  ts: number;
  unread: number;
}

export default function Chats() {
  const { token } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [{ agents }, convResult] = await Promise.all([
        api.listAgents(token),
        api.listConversations(token).catch(() => ({ conversations: [] as ConversationSummary[] })),
      ]);
      const byAgent = new Map<string, ConversationSummary>();
      for (const c of convResult.conversations) byAgent.set(c.agent.id, c);

      const merged: Row[] = agents.map((a) => {
        const c = byAgent.get(a.id);
        const preview = c?.last_message
          ? (c.last_message.role === "assistant" ? "" : "You: ") + c.last_message.content.replace(/\s+/g, " ").trim()
          : "Tap to start a conversation";
        return { ...a, preview, time: c?.last_message_at ?? null, ts: c?.last_message_at ? Date.parse(c.last_message_at) : 0, unread: c?.unread_count ?? 0 };
      });
      merged.sort((x, y) => y.ts - x.ts || x.name.localeCompare(y.name));
      setRows(merged);
    } catch (e) {
      if (e instanceof ApiError) console.warn(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceBright }}>
      <Stack.Screen
        options={{
          title: "Chats",
          headerLeft: () => (
            <Pressable onPress={() => router.push("/settings")} hitSlop={12} style={{ paddingHorizontal: 4 }}>
              <MaterialIcons name="settings" size={24} color={colors.text} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push("/agents/new")} hitSlop={12} style={{ paddingHorizontal: 4 }}>
              <MaterialIcons name="add" size={28} color={colors.secondary} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.textMuted} />}
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: "center", paddingTop: 90, paddingHorizontal: 24 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 18, marginBottom: 8 }}>No agents yet</Text>
              <Text style={{ color: colors.textMuted, fontFamily: fonts.body, textAlign: "center", marginBottom: 20 }}>Create your first agent to start chatting.</Text>
              <Pressable onPress={() => router.push("/agents/new")} style={{ backgroundColor: colors.secondaryContainer, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 }}>
                <Text style={{ color: colors.onSecondaryContainer, fontFamily: fonts.bold }}>New agent</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const unread = item.unread > 0;
          return (
            <Pressable
              onPress={() => router.push(`/agents/${item.id}/chat?name=${encodeURIComponent(item.name)}`)}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  backgroundColor: pressed ? colors.surfaceContainer : colors.surfaceContainerLowest,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.outlineVariant + "55",
                },
              ]}
            >
              <View style={{ width: 48, height: 48 }}>
                <Avatar name={item.name} size={48} />
                <View style={{ position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, backgroundColor: colors.status[item.status] || colors.textMuted, borderWidth: 2, borderColor: colors.surfaceContainerLowest }} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{item.name}</Text>
                  <Text style={{ color: unread ? colors.secondary : colors.textFaint, fontFamily: fonts.label, fontSize: 12, marginLeft: 8 }}>{shortTime(item.time)}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                  <Text style={{ flex: 1, color: unread ? colors.text : colors.textMuted, fontFamily: unread ? fonts.semibold : fonts.body, fontSize: 14 }} numberOfLines={1}>
                    {item.preview}
                  </Text>
                  {unread ? (
                    <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center", marginLeft: 8 }}>
                      <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 11 }}>{item.unread > 99 ? "99+" : item.unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {/* Edit this agent */}
              <Pressable onPress={() => router.push(`/agents/${item.id}/edit`)} hitSlop={10} style={{ padding: 4 }}>
                <MaterialIcons name="tune" size={20} color={colors.textFaint} />
              </Pressable>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
