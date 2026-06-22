import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { Agent } from "../lib/types";
import { MODELS_BY_PROVIDER, PROVIDERS, slugify } from "../lib/models";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Field, SelectField, ToggleRow } from "./ui";
import { colors } from "../theme/colors";

type ModelOption = { value: string; label: string; hint?: string };

export interface AgentFormValue {
  agent: Partial<Agent>;
  ai_config: { provider: string; model_id: string; temperature: number; max_tokens: number };
}

const CAPABILITIES: { key: string; label: string; description: string }[] = [
  { key: "tasks", label: "Tasks & delegation", description: "Create tasks and delegate to other agents." },
  { key: "scheduling", label: "Scheduling", description: "Reminders and recurring work." },
  { key: "integrations", label: "Integrations", description: "Gmail, Slack, Notion + 250 more." },
  { key: "recall", label: "History & recall", description: "Search past conversations and actions." },
  { key: "knowledge_base", label: "Knowledge base", description: "Search your uploaded documents." },
];

const EMAIL_PERMS = [
  { value: "auto", label: "Auto — send immediately" },
  { value: "draft", label: "Draft — require approval" },
  { value: "never", label: "Never — disabled" },
];

export function AgentForm({
  mode,
  initial,
  submitting,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: Agent | null;
  submitting?: boolean;
  onSubmit: (value: AgentFormValue) => void;
}) {
  const { token } = useAuth();
  // Model catalog: seed from the static fallback, then replace with the live
  // catalog from the API so it always matches the web new-agent form.
  const [catalog, setCatalog] = useState<Record<string, ModelOption[]>>(MODELS_BY_PROVIDER);
  const [providerList, setProviderList] = useState<string[]>(PROVIDERS);

  useEffect(() => {
    if (!token) return;
    api
      .modelCatalog(token)
      .then((res) => {
        if (res?.models_by_provider && Object.keys(res.models_by_provider).length) {
          setCatalog(res.models_by_provider);
          setProviderList(res.providers?.length ? res.providers : Object.keys(res.models_by_provider));
        }
      })
      .catch(() => {}); // keep the static fallback
  }, [token]);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [role, setRole] = useState(initial?.role ?? "");
  const [provider, setProvider] = useState(initial?.ai_config?.provider ?? "anthropic");
  const [modelId, setModelId] = useState(initial?.ai_config?.model_id ?? "claude-sonnet-4-6");
  const [daily, setDaily] = useState(String(initial?.spend_daily_cap_usd ?? "15"));
  const [monthly, setMonthly] = useState(String(initial?.spend_monthly_cap_usd ?? "150"));
  const [sendEmail, setSendEmail] = useState(initial?.permissions?.send_email ?? "draft");
  const [caps, setCaps] = useState<Record<string, boolean>>(() => {
    const initialCaps = initial?.capabilities || {};
    const out: Record<string, boolean> = {};
    for (const c of CAPABILITIES) out[c.key] = initialCaps[c.key]?.enabled ?? (mode === "create");
    return out;
  });

  const modelOptions = useMemo(() => {
    const list = catalog[provider] || [];
    // Ensure the current model is selectable even if not in the catalog.
    if (modelId && !list.some((m) => m.value === modelId)) {
      return [{ value: modelId, label: modelId }, ...list];
    }
    return list;
  }, [catalog, provider, modelId]);

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  const valid = name.trim() && slug.trim() && role.trim() && modelId;

  function submit() {
    const capabilities: Record<string, { enabled: boolean }> = {};
    for (const c of CAPABILITIES) capabilities[c.key] = { enabled: !!caps[c.key] };

    onSubmit({
      agent: {
        name: name.trim(),
        slug: slug.trim(),
        role: role.trim(),
        spend_daily_cap_usd: daily === "" ? undefined : Number(daily),
        spend_monthly_cap_usd: monthly === "" ? undefined : Number(monthly),
        permissions: { send_email: sendEmail },
        capabilities,
      },
      ai_config: { provider, model_id: modelId, temperature: 0.7, max_tokens: 8192 },
    });
  }

  return (
    <View>
      <SectionLabel>Identity</SectionLabel>
      <Field label="Name" value={name} onChangeText={handleNameChange} placeholder="e.g. Casper" />
      <Field
        label="Slug"
        value={slug}
        onChangeText={(v) => {
          setSlug(v);
          setSlugTouched(true);
        }}
        autoCapitalize="none"
        placeholder="casper"
        hint="Used for the agent's email + URL."
      />
      <Field label="Role" value={role} onChangeText={setRole} placeholder="e.g. Research Assistant" />

      <SectionLabel>Model</SectionLabel>
      <SelectField
        label="Provider"
        value={provider}
        options={providerList.map((p) => ({ value: p, label: p }))}
        onChange={(p) => {
          setProvider(p);
          const first = catalog[p]?.[0]?.value;
          if (first) setModelId(first);
        }}
      />
      <SelectField label="Model" value={modelId} options={modelOptions} onChange={setModelId} />

      <SectionLabel>Spend caps (USD)</SectionLabel>
      <Field label="Daily cap" value={daily} onChangeText={setDaily} keyboardType="decimal-pad" placeholder="15" />
      <Field label="Monthly cap" value={monthly} onChangeText={setMonthly} keyboardType="decimal-pad" placeholder="150" />

      <SectionLabel>Permissions</SectionLabel>
      <SelectField label="Send email" value={sendEmail} options={EMAIL_PERMS} onChange={setSendEmail} />

      <SectionLabel>Capabilities</SectionLabel>
      <View style={{ marginBottom: 24 }}>
        {CAPABILITIES.map((c) => (
          <ToggleRow
            key={c.key}
            label={c.label}
            description={c.description}
            value={!!caps[c.key]}
            onValueChange={(v) => setCaps((prev) => ({ ...prev, [c.key]: v }))}
          />
        ))}
      </View>

      <Button
        title={mode === "create" ? "Create agent" : "Save changes"}
        onPress={submit}
        loading={submitting}
        disabled={!valid}
      />
      {!valid ? (
        <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 10, textAlign: "center" }}>
          Name, slug, role and a model are required.
        </Text>
      ) : null}
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: colors.textFaint,
        fontSize: 12,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginTop: 8,
        marginBottom: 12,
      }}
    >
      {children}
    </Text>
  );
}
