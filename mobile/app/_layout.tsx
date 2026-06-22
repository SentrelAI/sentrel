import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/lib/auth";
import { colors } from "../src/theme/colors";

export default function RootLayout() {
  const router = useRouter();
  const lastHandled = useRef<string | null>(null);

  // Tapping a push notification deep-links into the relevant agent. The data
  // payload is set by the backend (MobilePushJob): {type, agent_id, ...}.
  useEffect(() => {
    function handle(response: Notifications.NotificationResponse) {
      const id = response.notification.request.identifier;
      if (lastHandled.current === id) return;
      lastHandled.current = id;
      const data = response.notification.request.content.data as any;
      if (!data?.agent_id) return;
      if (data.type === "agent_reply") {
        router.push(`/agents/${data.agent_id}/chat`);
      } else {
        router.push(`/agents/${data.agent_id}`);
      }
    }

    // Cold start: app opened from a notification.
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) handle(r);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [router]);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
