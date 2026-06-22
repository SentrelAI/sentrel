import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { AgentForm, AgentFormValue } from "../../../../src/components/AgentForm";
import { api, ApiError } from "../../../../src/lib/api";
import { useAuth } from "../../../../src/lib/auth";
import type { Agent } from "../../../../src/lib/types";
import { colors } from "../../../../src/theme/colors";

export default function EditAgent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || !id) return;
    api
      .getAgent(token, id)
      .then(({ agent }) => setAgent(agent))
      .catch((e) => Alert.alert("Error", e instanceof ApiError ? e.message : "Failed to load"));
  }, [token, id]);

  async function onSubmit(value: AgentFormValue) {
    if (!token || !id) return;
    setSubmitting(true);
    try {
      await api.updateAgent(token, id, value.agent, value.ai_config);
      router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof ApiError ? e.message : "Unknown error");
      setSubmitting(false);
    }
  }

  if (!agent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <AgentForm mode="edit" initial={agent} submitting={submitting} onSubmit={onSubmit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
