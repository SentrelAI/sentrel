import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

// Foreground behavior: show the banner + play a sound even while the app is
// open, so an agent reply / spend alert isn't silently swallowed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Ask the OS for permission, fetch the Expo push token, and register it with
// the backend so MobilePushJob can target this device. Returns the token, or
// null if unavailable (simulator, permission denied, web).
export async function registerForPushNotifications(authToken: string): Promise<string | null> {
  if (!Device.isDevice) return null; // push tokens require a physical device

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  try {
    const tokenResp = await Notifications.getExpoPushTokenAsync();
    const expoToken = tokenResp.data;
    await api.registerPushToken(authToken, expoToken, Platform.OS);
    return expoToken;
  } catch {
    return null;
  }
}
