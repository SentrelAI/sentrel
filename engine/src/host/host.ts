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

import type { Agent, Conversation, ConversationSummary, Message, ScheduledTask, SubAgent } from "../types.js";

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
  ): Promise<void>;
  updateAgentMemory(agentId: number, memoryMd: string): Promise<void>;
  updateAgentStatus(agentId: number, status: string): Promise<void>;
  updateAgentCommandAllowlist(agentId: number, allowlist: string[]): Promise<void>;

  // ── Skills ──
  getAgentSkills(agentId: number): Promise<AgentSkill[]>;

  // ── Scheduling ──
  getScheduledTasks(agentId: number): Promise<ScheduledTask[]>;
  createScheduledTask(orgId: number, agentId: number, name: string, instruction: string, cronExpression: string, timezone?: string): Promise<number>;
  updateScheduledTask(id: number, updates: { name?: string; instruction?: string; cron_expression?: string; timezone?: string; active?: boolean }): Promise<void>;
  deleteScheduledTask(id: number): Promise<void>;
  updateScheduledTaskLastRun(id: number): Promise<void>;

  // ── Tasks ──
  createTask(orgId: number, agentId: number, title: string, opts?: { description?: string; instruction?: string; priority?: string; due_at?: string }): Promise<number>;
  listTasks(agentId: number, status?: string): Promise<Array<{ id: number; title: string; description: string | null; status: string; priority: string; due_at: string | null; created_at: string }>>;
  updateTask(id: number, updates: { status?: string; title?: string; description?: string; priority?: string; due_at?: string; result?: Record<string, unknown> }): Promise<void>;
  addTaskComment(taskId: number, agentId: number, content: string): Promise<number>;

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
