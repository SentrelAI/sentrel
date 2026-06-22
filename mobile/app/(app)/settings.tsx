import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Avatar } from "../../src/components/Avatar";
import { ServerBadge } from "../../src/components/ServerBadge";
import { api, ApiError, getApiBaseUrl } from "../../src/lib/api";
import type { OrgListItem } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { colors, fonts, radius } from "../../src/theme/colors";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: colors.textMuted, fontFamily: fonts.label, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 10, paddingHorizontal: 20 }}>
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ marginHorizontal: 16, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.outlineVariant + "66", overflow: "hidden" }}>
      {children}
    </View>
  );
}

export default function Settings() {
  const { user, token, applyUser, signOut } = useAuth();
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [switching, setSwitching] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);

  const loadOrgs = useCallback(async () => {
    if (!token) return;
    try {
      const { organizations } = await api.listOrgs(token);
      setOrgs(organizations);
    } catch {
      /* ignore */
    } finally {
      setLoadingOrgs(false);
    }
  }, [token]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  async function switchTo(org: OrgListItem) {
    if (!token || org.is_current) return;
    setSwitching(org.id);
    try {
      const res = await api.switchOrg(token, org.id);
      applyUser(res.user);
      setOrgs(res.organizations);
      router.replace(res.onboarding_required ? "/onboarding" : "/chats");
    } catch (e) {
      Alert.alert("Error", e instanceof ApiError ? e.message : "Could not switch organization");
    } finally {
      setSwitching(null);
    }
  }

  async function testPush() {
    if (!token) return;
    setTesting(true);
    try {
      const res = await api.testPush(token);
      Alert.alert(res.ok ? "Sent" : "No push token", res.ok ? "A test notification is on its way." : "Allow notifications and reopen the app to register this device.");
    } catch (e) {
      Alert.alert("Error", e instanceof ApiError ? e.message : "Failed");
    } finally {
      setTesting(false);
    }
  }

  async function onServerChange() {
    await signOut();
    router.replace("/login");
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surfaceBright }} contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={{ alignItems: "center", paddingTop: 16, paddingBottom: 8 }}>
        <Avatar name={user?.name || "?"} size={84} />
        <Text style={{ color: colors.text, fontFamily: fonts.extrabold, fontSize: 22, marginTop: 12 }}>{user?.name}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>{user?.email}</Text>
      </View>

      <SectionLabel>Organizations</SectionLabel>
      <Card>
        {loadingOrgs ? (
          <View style={{ padding: 18 }}><ActivityIndicator color={colors.textMuted} /></View>
        ) : (
          orgs.map((o, i) => (
            <Pressable
              key={o.id}
              onPress={() => switchTo(o)}
              disabled={o.is_current || switching != null}
              style={({ pressed }) => [
                { flexDirection: "row", alignItems: "center", padding: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.outlineVariant + "55" },
                pressed && { backgroundColor: colors.surfaceContainer },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: o.is_current ? fonts.bold : fonts.bodyMedium, fontSize: 15 }}>{o.name}</Text>
                <Text style={{ color: colors.textFaint, fontFamily: fonts.label, fontSize: 12, marginTop: 1 }}>
                  {o.role}{!o.onboarding_completed ? " · setup incomplete" : ""}
                </Text>
              </View>
              {switching === o.id ? <ActivityIndicator color={colors.secondary} /> : o.is_current ? <MaterialIcons name="check-circle" size={20} color={colors.secondary} /> : <Text style={{ color: colors.secondary, fontFamily: fonts.labelSemibold }}>Switch</Text>}
            </Pressable>
          ))
        )}
        <Pressable
          onPress={() => router.push("/organizations/new")}
          style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: colors.outlineVariant + "55" }, pressed && { backgroundColor: colors.surfaceContainer }]}
        >
          <MaterialIcons name="add" size={20} color={colors.secondary} />
          <Text style={{ color: colors.secondary, fontFamily: fonts.bold, fontSize: 15 }}>New organization</Text>
        </Pressable>
      </Card>

      <SectionLabel>Notifications</SectionLabel>
      <Card>
        <Pressable onPress={testPush} disabled={testing} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16 }, pressed && { backgroundColor: colors.surfaceContainer }]}>
          <MaterialIcons name="notifications-active" size={20} color={colors.textMuted} />
          <Text style={{ color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 15, flex: 1 }}>Send a test notification</Text>
          {testing ? <ActivityIndicator color={colors.textMuted} /> : <MaterialIcons name="chevron-right" size={20} color={colors.textFaint} />}
        </Pressable>
      </Card>

      <SectionLabel>Server (testing)</SectionLabel>
      <Card>
        <View style={{ padding: 16, alignItems: "center", gap: 10 }}>
          <ServerBadge onChange={onServerChange} />
          <Text style={{ color: colors.textFaint, fontFamily: fonts.label, fontSize: 11 }}>{getApiBaseUrl()}</Text>
        </View>
      </Card>

      <View style={{ padding: 16, marginTop: 8 }}>
        <Pressable
          onPress={async () => { await signOut(); router.replace("/login"); }}
          style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger }, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="logout" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontFamily: fonts.bold, fontSize: 15 }}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
