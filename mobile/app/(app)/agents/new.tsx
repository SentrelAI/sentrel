import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { AgentForm, AgentFormValue } from "../../../src/components/AgentForm";
import { api, ApiError } from "../../../src/lib/api";
import { useAuth } from "../../../src/lib/auth";
import { colors } from "../../../src/theme/colors";

export default function NewAgent() {
  const { token } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(value: AgentFormValue) {
    if (!token) return;
    setSubmitting(true);
    try {
      const { agent } = await api.createAgent(token, value.agent, value.ai_config);
      router.replace(`/agents/${agent.id}`);
    } catch (e) {
      Alert.alert("Could not create agent", e instanceof ApiError ? e.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <AgentForm mode="create" submitting={submitting} onSubmit={onSubmit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
