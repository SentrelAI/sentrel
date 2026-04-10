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
}
