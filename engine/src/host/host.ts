// Sprint 0d — Host abstraction
//
// All persistence + state-fetching the engine needs flows through this interface.
// One implementation today (RailsPostgresHost) talks to the Rails Postgres schema.
// Future implementations could be LocalSqliteHost (standalone mode), MockHost
// (tests), or a remote HTTP-backed host.
//
// Rule: nothing outside `src/host/` may import from `pg`, query a database
// directly, or know about Rails table names. The engine talks to `host.foo()`,
// the Host implementation owns the schema.

import type { Agent, Conversation, ConversationSummary, Message, ScheduledWorkItem, SubAgent } from "../types.js";

export interface ChannelConfig {
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  status: string;
}

export interface PendingApproval {
  id: number;
  agent_id: number;
  tool_name: string;
  tool_input: Record<string, unknown>;
  status: string;
  context?: string | null;
  message_id?: number | null;
}

// Sprint 6 — skills
export interface AgentSkill {
  slug: string;
  name: string;
  description: string;
  skill_md: string;
  category: string;
  requires_connections: string[];
  enabled: boolean;
  // Phase 4 — explicit dependencies + system-prompt fragment.
  required_capabilities: string[];
  required_integrations: string[];
  system_prompt_fragment: string | null;
}

// Extra L — observability fields surfaced to audit_logs as columns so they
// can be indexed, aggregated, and joined (task_id FK) cheaply.
export interface AuditLogExtra {
  routedToolkits?: string[];
  taskId?: number | null;
  wasResume?: boolean;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  // Observability dashboard fields
  spans?: unknown[];
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  firstTokenMs?: number | null;
  modelId?: string | null;
  jobId?: string;
  conversationIdRef?: string | null;
  // Snapshot of resolveCapabilities(agent) at run time — debugging field
  // for "why didn't the agent use capability X?" after-the-fact.
  activeCapabilities?: Record<string, unknown>;
}

// Sprint 1 — blob storage
export interface BlobUploadResult {
  signed_id: string;          // Rails ActiveStorage signed_id, opaque
  filename: string;
  content_type: string;
  byte_size: number;
}

// Sprint 0e — cross-conversation message recall
export interface SearchMessagesFilters {
  organizationId: number;     // MANDATORY — tenant scoping, never allow null/undefined
  query?: string;             // fuzzy text search via pg_trgm
  contact?: string;           // matches conversation contact_email/phone/identifier
  conversationId?: number;
  channel?: string;
  daysBack?: number;          // default 90
  limit?: number;             // default 20, max 100
}

export interface SearchMessageResult {
  conversation_id: number;
  channel: string | null;
  contact_identifier: string | null;
  contact_name: string | null;
  role: string;
  content: string;            // truncated to 500 chars by host
  created_at: string;
  agent_id: number;
}

// Post-V1 #1 — full activity recall
export interface SearchActivityFilters {
  organizationId: number;
  query?: string;
  agentId?: number;
  type?: "email" | "approval" | "task" | "error" | "tool_call";
  contact?: string;
  daysBack?: number;          // default 90
  limit?: number;             // default 20, max 100
}

export interface ActivityResult {
  type: "email_sent" | "email_received" | "approval" | "task" | "error" | "tool_call";
  action: string;
  agent_id: number;
  agent_name?: string;
  status: string;
  summary: string;            // human-readable one-liner
  details: Record<string, unknown>;
  created_at: string;
}

export interface Host {
  // ── Identity & config ──
  getAgent(id: string): Promise<Agent>;
  getChannelConfigs(agentId: string): Promise<ChannelConfig[]>;
  getSubAgents(managerId: number): Promise<SubAgent[]>;

  // ── Conversations + messages ──
  getConversation(id: number): Promise<Conversation | null>;
  getInternalConversation(agentId: number): Promise<Conversation | null>;
  findOrCreateConversation(
    agentId: number,
    orgId: number,
    kind: "internal" | "external",
    contactIdentifier: string,
    contactName?: string,
    contactEmail?: string,
    contactPhone?: string,
  ): Promise<Conversation>;
  getConversationHistory(conversationId: number, limit?: number): Promise<Message[]>;
  saveMessage(
    conversationId: number,
    role: "user" | "assistant" | "system",
    content: string,
    direction?: string,
    channel?: string,
    toolCalls?: unknown[],
    metadata?: Record<string, unknown>,
  ): Promise<Message>;

  // ── Sessions + summaries (Sprint 0b) ──
  updateConversationSessionId(
    conversationId: number,
    sessionId: string | null,
    turnCount: number,
  ): Promise<void>;
  appendConversationSummary(conversationId: number, summary: ConversationSummary): Promise<void>;

  // ── Approvals ──
  savePendingApproval(
    orgId: number,
    agentId: number,
    toolName: string,
    toolInput: unknown,
    context?: string,
    messageId?: number,
  ): Promise<number>;
  getLatestPendingApproval(agentId: number): Promise<PendingApproval | null>;
  getApprovalById(id: number): Promise<PendingApproval | null>;
  updateApprovalStatus(approvalId: number, status: "approved" | "rejected"): Promise<void>;

  // ── Audit + agent state ──
  saveAuditLog(
    orgId: number,
    agentId: number,
    action: string,
    toolName?: string,
    input?: unknown,
    output?: unknown,
    status?: string,
    extra?: AuditLogExtra,
  ): Promise<void>;
  updateAgentMemory(agentId: number, memoryMd: string): Promise<void>;
  updateAgentStatus(agentId: number, status: string): Promise<void>;
  updateAgentCommandAllowlist(agentId: number, allowlist: string[]): Promise<void>;
  enableCapability(agentId: number, key: string): Promise<boolean>;

  // ── Skills ──
  getAgentSkills(agentId: number): Promise<AgentSkill[]>;

  // Layer 1 tool routing: recent Composio tool names from audit logs
  getRecentAuditToolCalls(agentId: number, limit: number): Promise<string[]>;

  // ── Scheduling (unified — scheduled_work) ──
  getScheduledWork(agentId: number): Promise<ScheduledWorkItem[]>;
  createScheduledWork(orgId: number, agentId: number, item: Omit<ScheduledWorkItem, "id" | "last_run_at" | "next_run_at">): Promise<number>;
  updateScheduledWork(id: number, updates: Partial<Pick<ScheduledWorkItem, "name" | "instruction" | "cron_expression" | "timezone" | "fire_at" | "interval_seconds" | "active">>): Promise<void>;
  deleteScheduledWork(id: number): Promise<void>;
  updateScheduledWorkLastRun(id: number): Promise<void>;

  // ── Tasks ──
  createTask(orgId: number, agentId: number, title: string, opts?: { description?: string; instruction?: string; priority?: string; due_at?: string; assignedByAgentId?: number }): Promise<number>;
  findAgentBySlugOrRole(orgId: number, slug?: string | null, role?: string | null): Promise<{ id: number; name: string; slug: string; role: string } | null>;
  getTeammates(orgId: number, excludeAgentId: number): Promise<Array<{ id: number; name: string; slug: string; role: string; manager_id: number | null; summary: string | null; skills: string[] }>>;
  publishInboundToAgent(targetAgentId: number, payload: {
    type: "task_assignment";
    jobId: string;
    orgId?: number;
    conversationId?: number | null;
    // Origin of the user inbound that started this delegation chain. Forwarded
    // verbatim so a multi-hop report-back can route back to the original
    // channel (Telegram chat, web conversation, etc.).
    origin?: {
      channel: string;
      metadata: Record<string, unknown>;
      conversationId?: number | null;
    };
    payload: Record<string, unknown>;
  }): Promise<void>;
  listTasks(agentId: number, status?: string): Promise<Array<{ id: number; title: string; description: string | null; status: string; priority: string; due_at: string | null; created_at: string }>>;
  updateTask(id: number, updates: { status?: string; title?: string; description?: string; priority?: string; due_at?: string; result?: Record<string, unknown>; progress_summary?: string }): Promise<void>;
  addTaskComment(taskId: number, agentId: number, content: string): Promise<number>;
  // Step 5.5 — long-running task primitives
  getTask(id: number): Promise<{ id: number; title: string; status: string; checkpoint: Record<string, unknown>; conversation_id: number | null; assigned_by_agent_id: number | null; organization_id: number; agent_id: number } | null>;
  writeTaskCheckpoint(id: number, checkpoint: Record<string, unknown>): Promise<void>;

  // ── Cross-conversation message recall (Sprint 0e) ──
  // Returns messages matching the filters, scoped to organizationId.
  // Implementations MUST enforce the organizationId filter — never allow
  // cross-org reads, even if other filters are missing.
  searchMessages(filters: SearchMessagesFilters): Promise<SearchMessageResult[]>;

  // Post-V1 #1 — full activity recall (audit logs, emails, approvals, tasks)
  searchActivity(filters: SearchActivityFilters): Promise<ActivityResult[]>;

  // ── Blob storage (Sprint 1+2) ──
  uploadBlob(bytes: Buffer, filename: string, contentType: string): Promise<BlobUploadResult>;
  loadBlob(signedId: string): Promise<{ bytes: Buffer; filename: string; contentType: string }>;

  // ── Email sending ──
  // Enqueues an email for immediate sending via the host's email infrastructure.
  // Replaces the old Redis queue + poller pattern — this is synchronous from
  // the engine's perspective (fire and forget, host handles retry/queue).
  sendEmail(payload: Record<string, unknown>): Promise<void>;
}
