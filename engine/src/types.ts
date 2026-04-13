export interface Agent {
  id: number;
  organization_id: number;
  manager_id: number | null;
  name: string;
  slug: string;
  role: string;
  status: string;
  identity_md: string | null;
  personality_md: string | null;
  instructions_md: string | null;
  memory_md: string | null;
  permissions: Record<string, string>;
  heartbeat_enabled: boolean;
  heartbeat_interval_minutes: number;
  ai_config: AiConfig | null;
  organization: Organization;
}

export interface AiConfig {
  provider: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
  thinking_level: string;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  context_md?: string | null;
}

export interface Conversation {
  id: number;
  organization_id: number;
  agent_id: number;
  kind: "internal" | "external";
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_identifier: string | null;
  subject: string | null;
  status: string;
  // Sprint 0b — session resume + summaries
  claude_session_id?: string | null;
  claude_session_turn_count?: number;
  last_message_at?: string | null;
  summaries?: ConversationSummary[];
}

export interface ConversationSummary {
  summarized_at: string;
  turn_range: string; // e.g. "1-30"
  summary: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  direction: string | null;
  channel: string | null;
  tool_calls: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SubAgent {
  id: number;
  name: string;
  slug: string;
  role: string;
  identity_md: string | null;
  personality_md: string | null;
  instructions_md: string | null;
  ai_config: AiConfig | null;
}

export interface ScheduledTask {
  id: number;
  name: string;
  instruction: string;
  cron_expression: string;
  timezone: string;
  active: boolean;
}

export interface JobData {
  type: "inbound_message" | "heartbeat" | "scheduled_task" | "task_assignment";
  conversationId?: number;
  agentId: string;
  orgId?: number;
  channel?: string;
  payload?: {
    from?: string;
    from_name?: string;
    to?: string;
    cc?: string[];
    subject?: string;
    body?: string;
    instruction?: string;
    taskId?: number;
    // Sprint 1 — inbound media. Channels (Telegram/WhatsApp/web) upload files
    // to host blob storage and pass the resulting signed_ids here. Sprint 2's
    // prompt builder will fetch them and turn into Claude content blocks.
    attachment_ids?: string[];
  };
}
