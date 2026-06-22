import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { FuturisticBackground } from "../../src/components/FuturisticBackground";
import { PulsingOrb } from "../../src/components/PulsingOrb";
import { Button, Field } from "../../src/components/ui";
import { api, ApiError } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { colors } from "../../src/theme/colors";

type Step = "welcome" | "website" | "building";

export default function Onboarding() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill a suggested website from the user's email domain.
  useEffect(() => {
    if (!token) return;
    api.onboarding(token).then((d) => {
      if (d.suggested_website && !website) setWebsite(d.suggested_website);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function analyzeThenContinue() {
    if (!token) return;
    setError(null);
    if (website.trim()) {
      setBusy(true);
      try {
        await api.onboardingAnalyze(token, website.trim());
      } catch {
        // best-effort — analysis isn't required to finish
      } finally {
        setBusy(false);
      }
    }
    finish(true);
  }

  async function finish(generate: boolean) {
    if (!token) return;
    setStep("building");
    setBusy(true);
    try {
      if (generate) await api.onboardingComplete(token);
      else await api.onboardingSkip(token);
      router.replace("/agents");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not finish setup.");
      setStep("welcome");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FuturisticBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <PulsingOrb size={140} />
          </View>

          {step === "building" ? (
            <View style={{ alignItems: "center" }}>
              <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800" }}>Building your team…</Text>
              <Text style={{ color: colors.textMuted, marginTop: 8, textAlign: "center" }}>
                Spinning up your first AI employees.
              </Text>
            </View>
          ) : step === "welcome" ? (
            <View style={{ alignItems: "center" }}>
              <Text style={{ color: colors.text, fontSize: 28, fontWeight: "800", textAlign: "center" }}>
                Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 15, marginTop: 10, marginBottom: 28, textAlign: "center", lineHeight: 22 }}>
                Let’s set up {user?.organization?.name || "your workspace"}. We’ll tailor your AI team to what you do.
              </Text>
              <View style={{ width: "100%", gap: 12 }}>
                <Button title="Get started" onPress={() => setStep("website")} />
                <Button title="Skip for now" variant="ghost" onPress={() => finish(false)} loading={busy} />
              </View>
            </View>
          ) : (
            <View style={{ width: "100%" }}>
              <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center" }}>
                What’s your website?
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 8, marginBottom: 24, textAlign: "center" }}>
                We’ll analyze it to tailor your agents. Optional — you can skip.
              </Text>
              <Field
                label="Website"
                value={website}
                onChangeText={setWebsite}
                placeholder="yourcompany.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
              <View style={{ gap: 12 }}>
                <Button title="Build my AI team" onPress={analyzeThenContinue} loading={busy} />
                <Pressable onPress={() => finish(false)} disabled={busy} style={{ alignItems: "center", paddingVertical: 8 }}>
                  <Text style={{ color: colors.textMuted }}>Skip</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
