import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field } from "../src/components/ui";
import { ServerBadge } from "../src/components/ServerBadge";
import { useAuth } from "../src/lib/auth";
import { getApiBaseUrl } from "../src/lib/api";
import { colors, fonts, radius } from "../src/theme/colors";

export default function Login() {
  const { signIn, signInWithGoogle } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [tick, setTick] = useState(0);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace("/chats");
    } catch (e: any) {
      setError(e?.status === 401 ? "Wrong email or password." : e?.message || "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      router.replace("/chats");
    } catch (e: any) {
      if (!e?.cancelled) setError(e?.message || "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceBright }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: insets.top + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <Image source={require("../assets/logo-black.png")} style={{ width: 210, height: 52, resizeMode: "contain" }} />
            <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 15, marginTop: 16 }}>Your AI workforce, in your pocket.</Text>
          </View>

          <View
            style={{
              backgroundColor: colors.surfaceContainerLowest,
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.outlineVariant + "88",
              padding: 20,
            }}
          >
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@company.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
            <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry textContentType="password" onSubmitEditing={onSubmit} />

            {error ? <Text style={{ color: colors.danger, fontFamily: fonts.body, marginBottom: 14, fontSize: 14 }}>{error}</Text> : null}

            <Button title="Sign in" onPress={onSubmit} loading={loading} disabled={!email || !password} />

            <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 16 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.outlineVariant }} />
              <Text style={{ color: colors.textFaint, fontFamily: fonts.label, fontSize: 12, marginHorizontal: 12 }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.outlineVariant }} />
            </View>

            <Button title="Continue with Google" variant="secondary" onPress={onGoogle} loading={googleLoading} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
            <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>New here? </Text>
            <Link href="/signup" asChild>
              <Pressable>
                <Text style={{ color: colors.secondary, fontFamily: fonts.bold }}>Create an account</Text>
              </Pressable>
            </Link>
          </View>

          <View style={{ marginTop: 28, alignItems: "center", gap: 8 }}>
            <ServerBadge onChange={() => setTick((t) => t + 1)} />
            <Text key={tick} style={{ color: colors.textFaint, fontFamily: fonts.label, fontSize: 11 }}>{getApiBaseUrl()}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
