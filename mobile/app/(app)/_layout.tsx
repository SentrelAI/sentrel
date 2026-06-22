import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../src/lib/auth";
import { registerForPushNotifications } from "../../src/lib/push";
import { colors } from "../../src/theme/colors";

export default function AppLayout() {
  const { token, loading } = useAuth();

  // Register for push as soon as we have a valid session. Best-effort —
  // failure (simulator / denied) just means no notifications.
  useEffect(() => {
    if (token) registerForPushNotifications(token).catch(() => {});
  }, [token]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: "700" },
        contentStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="agents/index" options={{ title: "Agents" }} />
      <Stack.Screen name="agents/new" options={{ title: "New agent", presentation: "modal" }} />
      <Stack.Screen name="agents/[id]/index" options={{ title: "Agent" }} />
      <Stack.Screen name="agents/[id]/edit" options={{ title: "Edit agent", presentation: "modal" }} />
      <Stack.Screen name="agents/[id]/chat" options={{ title: "Chat" }} />
      <Stack.Screen name="agents/[id]/ops" options={{ title: "Operations" }} />
      <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="organizations/new" options={{ title: "New organization", presentation: "modal" }} />
    </Stack>
  );
}
