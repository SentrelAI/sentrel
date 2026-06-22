export interface Organization {
  id: number;
  name: string;
  slug: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: Organization | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  model_id?: string | null;
  instance_status?: string | null;
}

export interface AiConfig {
  provider: string;
  model_id: string;
  temperature?: number | string;
  max_tokens?: number;
  thinking_level?: string;
}

export interface AgentInstance {
  status?: string;
  region?: string;
  provider?: string;
  machine_id?: string;
  public_ip?: string;
  health_checked_at?: string;
  started_at?: string;
  provisioning_error?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  identity_md?: string | null;
  personality_md?: string | null;
  instructions_md?: string | null;
  memory_md?: string | null;
  email_signature_md?: string | null;
  spend_daily_cap_usd?: string | number | null;
  spend_monthly_cap_usd?: string | number | null;
  spend_notify_threshold_pct?: string | number | null;
  heartbeat_enabled?: boolean;
  heartbeat_interval_minutes?: number;
  approval_mode?: string;
  permissions?: Record<string, string>;
  capabilities?: Record<string, { enabled?: boolean; [k: string]: unknown }>;
  ai_config?: AiConfig | null;
  instance?: AgentInstance | null;
  manager?: { id: string; name: string; slug: string } | null;
  created_at?: string;
  updated_at?: string;
}

export interface Spend {
  today_usd: number;
  seven_day_usd: number;
  thirty_day_usd: number;
  daily_cap_usd: number | null;
  monthly_cap_usd: number | null;
  runs_today: number;
  top_models: { model_id: string; runs: number; cost_usd: number }[];
}

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
  sender?: { name?: string; email?: string; kind?: string };
}

export interface OpsResult {
  ok: boolean;
  message: string;
  logs?: { timestamp?: string; level?: string; message: string; instance?: string }[];
}
