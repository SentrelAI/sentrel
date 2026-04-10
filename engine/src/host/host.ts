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

  // ── Scheduling ──
  getScheduledTasks(agentId: number): Promise<ScheduledTask[]>;

  // ── Cross-conversation message recall (Sprint 0e) ──
  // Returns messages matching the filters, scoped to organizationId.
  // Implementations MUST enforce the organizationId filter — never allow
  // cross-org reads, even if other filters are missing.
  searchMessages(filters: SearchMessagesFilters): Promise<SearchMessageResult[]>;
}
