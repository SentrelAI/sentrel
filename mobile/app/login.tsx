import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field } from "../src/components/ui";
import { FuturisticBackground } from "../src/components/FuturisticBackground";
import { ServerBadge } from "../src/components/ServerBadge";
import { ThinkingEyes } from "../src/components/ThinkingEyes";
import { useAuth } from "../src/lib/auth";
import { getApiBaseUrl } from "../src/lib/api";
import { colors } from "../src/theme/colors";

export default function Login() {
  const { signIn, signInWithGoogle } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [serverTick, setServerTick] = useState(0); // re-render the base-url line on toggle

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace("/agents");
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
      router.replace("/agents");
    } catch (e: any) {
      if (!e?.cancelled) setError(e?.message || "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FuturisticBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: insets.top + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand */}
          <View style={{ alignItems: "center", marginBottom: 36 }}>
            <View
              style={{
                shadowColor: colors.primary,
                shadowOpacity: 0.6,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 0 },
                marginBottom: 12,
              }}
            >
              <ThinkingEyes size={84} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontSize: 40, fontWeight: "800", letterSpacing: -1.5 }}>Sentrel</Text>
            <Text style={{ color: colors.textMuted, fontSize: 15, marginTop: 6, textAlign: "center" }}>
              Your AI workforce, in your pocket.
            </Text>
          </View>

          {/* Glass card */}
          <View
            style={{
              backgroundColor: "rgba(21,21,28,0.72)",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 20,
            }}
          >
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              textContentType="password"
              onSubmitEditing={onSubmit}
            />

            {error ? <Text style={{ color: colors.danger, marginBottom: 14, fontSize: 14 }}>{error}</Text> : null}

            <Button title="Sign in" onPress={onSubmit} loading={loading} disabled={!email || !password} />

            <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 16 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text style={{ color: colors.textFaint, fontSize: 12, marginHorizontal: 12 }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>

            <Button title="Continue with Google" variant="secondary" onPress={onGoogle} loading={googleLoading} />
          </View>

          {/* Sign up */}
          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
            <Text style={{ color: colors.textMuted }}>New here? </Text>
            <Link href="/signup" asChild>
              <Pressable>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>Create an account</Text>
              </Pressable>
            </Link>
          </View>

          {/* Server toggle (testing) */}
          <View style={{ marginTop: 28, alignItems: "center", gap: 8 }}>
            <ServerBadge onChange={() => setServerTick((t) => t + 1)} />
            <Text key={serverTick} style={{ color: colors.textFaint, fontSize: 11 }}>
              {getApiBaseUrl()}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
