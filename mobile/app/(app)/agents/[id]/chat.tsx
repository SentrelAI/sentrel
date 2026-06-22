import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThinkingEyes } from "../../../../src/components/ThinkingEyes";
import { api, ApiError } from "../../../../src/lib/api";
import { useAuth } from "../../../../src/lib/auth";
import type { Message } from "../../../../src/lib/types";
import { colors, fonts, radius } from "../../../../src/theme/colors";

const QUICK = ["What can you do?", "Summarize today", "Any updates?"];

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function Chat() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const lastSeen = useRef<string>("1970-01-01T00:00:00Z");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function ingest(incoming: Message[]) {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev, ...incoming.filter((m) => !seen.has(m.id))];
      merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return merged;
    });
    for (const m of incoming) if (m.created_at > lastSeen.current) lastSeen.current = m.created_at;
  }

  useEffect(() => {
    if (!token || !id) return;
    api
      .listMessages(token, id)
      .then(({ messages }) => ingest(messages))
      .catch((e) => e instanceof ApiError && console.warn(e.message))
      .finally(() => {
        setLoading(false);
        api.markRead(token, id).catch(() => {}); // viewing the thread = read
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  const poll = useCallback(async () => {
    if (!token || !id) return;
    try {
      const { messages } = await api.pollMessages(token, id, lastSeen.current);
      if (messages.length > 0) {
        ingest(messages);
        if (messages.some((m) => m.role === "assistant")) {
          setWaiting(false);
          api.markRead(token, id).catch(() => {}); // we're viewing → mark read
        }
      }
    } catch {
      /* keep polling */
    }
  }, [token, id]);

  useEffect(() => {
    pollTimer.current = setInterval(poll, 2000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [poll]);

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages.length]);

  async function send(text?: string) {
    const body = (text ?? input).trim();
    if (!body || !token || !id || sending) return;
    if (!text) setInput("");
    setSending(true);
    try {
      const res = await api.sendMessage(token, id, body);
      ingest([res.message]);
      setWaiting(true);
    } catch (e) {
      if (!text) setInput(body);
      ingest([{ id: -Date.now(), role: "system", content: `⚠️ ${e instanceof ApiError ? e.message : "Failed to send"}`, created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surfaceBright }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <Stack.Screen
        options={{
          title: name || "Chat",
          headerRight: () => (
            <Pressable onPress={() => router.push(`/agents/${id}/edit`)} hitSlop={12} style={{ paddingHorizontal: 4 }}>
              <MaterialIcons name="tune" size={22} color={colors.secondary} />
            </Pressable>
          ),
        }}
      />
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.secondary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          ListHeaderComponent={
            <View style={{ alignItems: "center", marginBottom: 14 }}>
              <View style={{ backgroundColor: colors.surfaceContainer, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill }}>
                <Text style={{ color: colors.textMuted, fontFamily: fonts.label, fontSize: 11 }}>Today</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>Say hello to start the conversation.</Text>
            </View>
          }
          renderItem={({ item }) => <Bubble message={item} />}
          ListFooterComponent={
            waiting ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}>
                <ThinkingEyes size={46} color={colors.textMuted} />
                <Text style={{ color: colors.textFaint, fontFamily: fonts.body, fontSize: 13 }}>Working…</Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Quick chips */}
      {messages.length === 0 && !loading ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
          {QUICK.map((q) => (
            <Pressable
              key={q}
              onPress={() => send(q)}
              style={{ backgroundColor: colors.surfaceContainerHighest, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill }}
            >
              <Text style={{ color: colors.textMuted, fontFamily: fonts.labelSemibold, fontSize: 12 }}>{q}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Input bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
          borderTopWidth: 1,
          borderTopColor: colors.outlineVariant + "66",
          backgroundColor: colors.surfaceContainerLow,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "flex-end",
            backgroundColor: colors.surfaceContainerLowest,
            borderWidth: 1,
            borderColor: colors.outline,
            borderRadius: 22,
            paddingHorizontal: 6,
            paddingVertical: 4,
            minHeight: 44,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a command or message…"
            placeholderTextColor={colors.textFaint}
            multiline
            style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 15, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 9, maxHeight: 120 }}
          />
        </View>
        <Pressable
          onPress={() => send()}
          disabled={!input.trim() || sending}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: input.trim() ? colors.secondary : colors.surfaceContainerHighest,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcons name="arrow-upward" size={22} color={input.trim() ? "#fff" : colors.textFaint} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  if (isSystem) {
    return (
      <View style={{ alignItems: "center", marginVertical: 6 }}>
        <Text style={{ color: colors.warning, fontFamily: fonts.body, fontSize: 12 }}>{message.content}</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 10 }}>
      {!isUser ? (
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryContainer, alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 2 }}>
          <MaterialIcons name="bolt" size={18} color="#fff" />
        </View>
      ) : null}
      <View
        style={{
          maxWidth: "78%",
          backgroundColor: isUser ? colors.secondaryContainer : colors.surfaceContainerHigh,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          borderTopRightRadius: isUser ? 4 : 18,
          borderTopLeftRadius: isUser ? 18 : 4,
        }}
      >
        <Text style={{ color: isUser ? colors.onSecondaryContainer : colors.text, fontFamily: fonts.body, fontSize: 15, lineHeight: 21 }}>
          {message.content}
        </Text>
        <Text style={{ color: isUser ? "#ffffffaa" : colors.textFaint, fontFamily: fonts.label, fontSize: 10, marginTop: 4, textAlign: "right" }}>
          {fmtTime(message.created_at)}
        </Text>
      </View>
    </View>
  );
}
