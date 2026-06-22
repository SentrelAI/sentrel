import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Button, Field } from "../../../src/components/ui";
import { api, ApiError } from "../../../src/lib/api";
import { useAuth } from "../../../src/lib/auth";
import { colors } from "../../../src/theme/colors";

export default function NewOrganization() {
  const { token, applyUser } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!token || !name.trim()) return;
    setBusy(true);
    try {
      const res = await api.createOrg(token, name.trim());
      applyUser(res.user); // active org is now the new one
      router.replace(res.onboarding_required ? "/onboarding" : "/agents");
    } catch (e) {
      Alert.alert("Error", e instanceof ApiError ? e.message : "Could not create organization");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.textMuted, marginBottom: 20, lineHeight: 20 }}>
          You’ll become the owner of this organization and switch into it.
        </Text>
        <Field label="Organization name" value={name} onChangeText={setName} placeholder="Acme Inc" autoFocus />
        <Button title="Create organization" onPress={create} loading={busy} disabled={!name.trim()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
