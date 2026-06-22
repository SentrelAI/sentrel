import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { api, ApiError, getApiBaseUrl } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import type { OrgListItem } from "../../src/lib/api";
import { Button, Card } from "../../src/components/ui";
import { ServerBadge } from "../../src/components/ServerBadge";
import { colors } from "../../src/theme/colors";

export default function Settings() {
  const { user, token, applyUser, signOut } = useAuth();
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [switching, setSwitching] = useState<number | null>(null);

  const loadOrgs = useCallback(async () => {
    if (!token) return;
    try {
      const { organizations } = await api.listOrgs(token);
      setOrgs(organizations);
    } catch {
      // ignore
    } finally {
      setLoadingOrgs(false);
    }
  }, [token]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  async function switchTo(org: OrgListItem) {
    if (!token || org.is_current) return;
    setSwitching(org.id);
    try {
      const res = await api.switchOrg(token, org.id);
      applyUser(res.user);
      setOrgs(res.organizations);
      if (res.onboarding_required) {
        router.replace("/onboarding");
      } else {
        router.replace("/agents");
      }
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
      Alert.alert(
        res.ok ? "Sent" : "No push token",
        res.ok
          ? "A test notification is on its way."
          : "This device hasn’t registered a push token yet. Allow notifications and reopen the app."
      );
    } catch (e) {
      Alert.alert("Error", e instanceof ApiError ? e.message : "Failed");
    } finally {
      setTesting(false);
    }
  }

  async function onServerChange() {
    // The current token belongs to the previous server — sign out and return
    // to login so the user authenticates against the newly selected server.
    await signOut();
    router.replace("/login");
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card style={{ marginBottom: 16 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{user?.name}</Text>
        <Text style={{ color: colors.textMuted, marginTop: 2 }}>{user?.email}</Text>
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />
        <KV k="Active org" v={user?.organization?.name || "—"} />
        <KV k="Role" v={user?.role || "—"} />
      </Card>

      {/* Organizations */}
      <Text style={styles_section}>Organizations</Text>
      <Card style={{ marginBottom: 8, padding: 0, overflow: "hidden" }}>
        {loadingOrgs ? (
          <View style={{ padding: 16 }}>
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : (
          orgs.map((o, i) => (
            <Pressable
              key={o.id}
              onPress={() => switchTo(o)}
              disabled={o.is_current || switching != null}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                },
                pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: o.is_current ? "700" : "500" }}>{o.name}</Text>
                <Text style={{ color: colors.textFaint, fontSize: 12 }}>
                  {o.role}
                  {!o.onboarding_completed ? " · setup incomplete" : ""}
                </Text>
              </View>
              {switching === o.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : o.is_current ? (
                <Text style={{ color: colors.primary, fontSize: 16 }}>✓</Text>
              ) : (
                <Text style={{ color: colors.textFaint }}>Switch</Text>
              )}
            </Pressable>
          ))
        )}
      </Card>
      <Button title="+ New organization" variant="ghost" onPress={() => router.push("/organizations/new")} />

      {/* Notifications */}
      <Text style={styles_section}>Notifications</Text>
      <Card style={{ marginBottom: 16 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 12 }}>
          You’ll be notified when an agent replies or hits a spend cap.
        </Text>
        <Button title="Send a test notification" variant="secondary" onPress={testPush} loading={testing} />
      </Card>

      {/* Server (testing) */}
      <Text style={styles_section}>Server (testing)</Text>
      <Card style={{ marginBottom: 16, alignItems: "center", gap: 10 }}>
        <ServerBadge onChange={onServerChange} />
        <Text style={{ color: colors.textFaint, fontSize: 11 }}>{getApiBaseUrl()}</Text>
      </Card>

      <Button title="Sign out" variant="danger" onPress={async () => { await signOut(); router.replace("/login"); }} />
    </ScrollView>
  );
}

const styles_section = {
  color: colors.textFaint,
  fontSize: 12,
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  marginTop: 20,
  marginBottom: 10,
};

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: colors.textMuted }}>{k}</Text>
      <Text style={{ color: colors.text }}>{v}</Text>
    </View>
  );
}
