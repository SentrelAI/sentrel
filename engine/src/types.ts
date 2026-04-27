export interface Capability {
  enabled: boolean;
  [k: string]: unknown;
}

export interface KnowledgeBaseCapability extends Capability {
  always_retrieve?: boolean;
  threshold?: number;
  top_k?: number;
}

export interface Capabilities {
  knowledge_base?: KnowledgeBaseCapability;
  scheduling?:    Capability;
  tasks?:         Capability;
  integrations?:  Capability;
  recall?:        Capability;
  send_media?:    Capability;
}

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
  approval_mode: "manual" | "smart" | "off";
  command_allowlist: string[];
  heartbeat_enabled: boolean;
  heartbeat_interval_minutes: number;
  capabilities: Capabilities;
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

// Unified scheduling: cron + once + interval in one table.
export interface ScheduledWorkItem {
  id: number;
  mode: "cron" | "once" | "interval";
  name: string;
  instruction: string;
  cron_expression: string | null;
  timezone: string;
  fire_at: string | null;         // ISO datetime for mode=once
  interval_seconds: number | null; // for mode=interval
  active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  payload_extra: Record<string, unknown>;
}

export interface JobData {
  type: "inbound_message" | "heartbeat" | "scheduled_task" | "task_assignment";
  // Correlation ID for routing the agent's emitDone back to the right channel
  // handler. Generated at enqueue time (Telegram poller / Rails AgentEventBus).
  // If missing, engine synthesizes one and logs a warning.
  jobId?: string;
  conversationId?: number;
  agentId: string;
  orgId?: number;
  channel?: string;
  // The channel + metadata of the *original* user inbound that started this
  // delegation chain. Set by the channel poller on first inbound, propagated
  // unchanged through every cross-agent delegation and report-back. When a
  // report-back lands and there's no native listener for the synthetic jobId,
  // the engine auto-delivers the agent's response to this origin so the user
  // hears back without the agent needing to explicitly call a send_* tool.
  origin?: {
    channel: string;                         // "telegram" | "web" | "whatsapp" | ...
    metadata: Record<string, unknown>;       // chat_id+bot_token, conversation_id, etc.
    conversationId?: number | null;
  };
  payload?: {
    from?: string;
    from_name?: string;
    to?: string;
    cc?: string[];
    subject?: string;
    body?: string;
    instruction?: string;
    taskId?: number;
    isReminder?: boolean;
    skipAutoComplete?: boolean;
    // Sprint 1 — inbound media
    attachment_ids?: string[];
    // Channel-specific metadata (chat_id, bot_token, message_sid, etc.)
    metadata?: Record<string, unknown>;
  };
}
