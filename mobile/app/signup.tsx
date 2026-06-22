import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field } from "../src/components/ui";
import { useAuth } from "../src/lib/auth";
import { colors, fonts, radius } from "../src/theme/colors";

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const valid = name.trim() && email.trim() && password.length >= 8;

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      const needsOnboarding = await signUp({ name, email, password, organizationName: org });
      router.replace(needsOnboarding ? "/onboarding" : "/chats");
    } catch (e: any) {
      setError(e?.messages?.join(", ") || e?.message || "Could not create your account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceBright }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: insets.top + 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ marginBottom: 28 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.5 }}>Create your workspace</Text>
            <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 15, marginTop: 6 }}>You'll be the owner of a new organization.</Text>
          </View>

          <View style={{ backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.outlineVariant + "88", padding: 20 }}>
            <Field label="Your name" value={name} onChangeText={setName} placeholder="Ada Lovelace" />
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@company.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
            <Field label="Organization name" value={org} onChangeText={setOrg} placeholder="Acme Inc (optional)" />
            <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry textContentType="newPassword" hint="Minimum 8 characters." />

            {error ? <Text style={{ color: colors.danger, fontFamily: fonts.body, marginBottom: 14, fontSize: 14 }}>{error}</Text> : null}

            <Button title="Create account" onPress={onSubmit} loading={loading} disabled={!valid} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
            <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>Already have an account? </Text>
            <Link href="/login" asChild>
              <Pressable>
                <Text style={{ color: colors.secondary, fontFamily: fonts.bold }}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
