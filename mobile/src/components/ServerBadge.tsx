import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { baseUrlFor, getServerEnv, setServerEnv, type ServerEnv } from "../lib/server";
import { colors, radius } from "../theme/colors";

// Small dev-only control to point the app at the local dev server vs the live
// production control plane. Switching while signed in invalidates the current
// token (it belongs to the other server), so we warn + call onChange so the
// caller can sign the user out.
export function ServerBadge({ onChange }: { onChange?: (env: ServerEnv) => void }) {
  const [env, setEnv] = useState<ServerEnv>(getServerEnv());

  function toggle() {
    const next: ServerEnv = env === "dev" ? "prod" : "dev";
    const apply = async () => {
      await setServerEnv(next);
      setEnv(next);
      onChange?.(next);
    };
    if (next === "prod") {
      Alert.alert(
        "Switch to PRODUCTION?",
        "The app will talk to the live production server and database. You'll be signed out and must log in again.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Use production", style: "destructive", onPress: apply },
        ]
      );
    } else {
      apply();
    }
  }

  const isProd = env === "prod";
  return (
    <Pressable
      onPress={toggle}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        alignSelf: "center",
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: isProd ? colors.danger : colors.border,
        backgroundColor: isProd ? "rgba(248,113,113,0.08)" : colors.surface,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isProd ? colors.danger : colors.success }} />
      <Text style={{ color: isProd ? colors.danger : colors.textMuted, fontSize: 12, fontWeight: "600" }}>
        {isProd ? "PRODUCTION" : "Local dev"}
      </Text>
      <Text style={{ color: colors.textFaint, fontSize: 11 }}>· tap to switch</Text>
    </Pressable>
  );
}

export function serverLabel(): string {
  return baseUrlFor(getServerEnv());
}
