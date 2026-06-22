import { Stack, useLocalSearchParams } from "expo-router";
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
import { colors, radius } from "../../../../src/theme/colors";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false); // awaiting an assistant reply
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
    for (const m of incoming) {
      if (m.created_at > lastSeen.current) lastSeen.current = m.created_at;
    }
  }

  // Initial history load.
  useEffect(() => {
    if (!token || !id) return;
    api
      .listMessages(token, id)
      .then(({ messages }) => {
        ingest(messages);
      })
      .catch((e) => {
        if (e instanceof ApiError) console.warn(e.message);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  // Poll for new assistant replies every 2s.
  const poll = useCallback(async () => {
    if (!token || !id) return;
    try {
      const { messages } = await api.pollMessages(token, id, lastSeen.current);
      if (messages.length > 0) {
        ingest(messages);
        if (messages.some((m) => m.role === "assistant")) setWaiting(false);
      }
    } catch {
      // transient — keep polling
    }
  }, [token, id]);

  useEffect(() => {
    pollTimer.current = setInterval(poll, 2000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [poll]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  async function send() {
    const body = input.trim();
    if (!body || !token || !id || sending) return;
    setInput("");
    setSending(true);
    try {
      const res = await api.sendMessage(token, id, body);
      ingest([res.message]);
      setWaiting(true);
    } catch (e) {
      setInput(body);
      const msg = e instanceof ApiError ? e.message : "Failed to send";
      ingest([
        {
          id: -Date.now(),
          role: "system",
          content: `⚠️ ${msg}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <Stack.Screen options={{ title: "Chat" }} />
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 80 }}>
              <Text style={{ color: colors.textMuted }}>Say hello to start the conversation.</Text>
            </View>
          }
          renderItem={({ item }) => <Bubble message={item} />}
          ListFooterComponent={
            waiting ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2, paddingVertical: 6 }}>
                <ThinkingEyes size={48} color={colors.textMuted} />
                <Text style={{ color: colors.textFaint, fontSize: 13 }}>Working…</Text>
              </View>
            ) : null
          }
        />
      )}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message…"
          placeholderTextColor={colors.textFaint}
          multiline
          style={{
            flex: 1,
            color: colors.text,
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.lg,
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 10,
            maxHeight: 120,
            fontSize: 15,
          }}
        />
        <Pressable
          onPress={send}
          disabled={!input.trim() || sending}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: input.trim() ? colors.primary : colors.surfaceAlt,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: input.trim() ? "#fff" : colors.textFaint, fontSize: 20 }}>↑</Text>
          )}
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
        <Text style={{ color: colors.warning, fontSize: 12 }}>{message.content}</Text>
      </View>
    );
  }
  return (
    <View
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        backgroundColor: isUser ? colors.primary : colors.surface,
        borderWidth: isUser ? 0 : 1,
        borderColor: colors.border,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 10,
        maxWidth: "85%",
      }}
    >
      <Text style={{ color: isUser ? "#fff" : colors.text, fontSize: 15, lineHeight: 21 }}>
        {message.content}
      </Text>
    </View>
  );
}
