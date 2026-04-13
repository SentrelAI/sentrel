// PostgresHost — Host implementation backed by Postgres.
// Owns ALL SQL in the engine. Nothing outside this file should call pg.Pool directly.
//
// The schema this expects is the one the Rails app's migrations create
// (agents, conversations, messages, audit_logs, etc.), but this class doesn't
// know or care about Rails — it just speaks Postgres against a known schema.
// If we ever fork the schema, that's a new Host implementation, not a change here.

import pg from "pg";
import { config } from "../config.js";
import type {
  Agent,
  Conversation,
  ConversationSummary,
  Message,
  ScheduledTask,
  SubAgent,
} from "../types.js";
import type {
  BlobUploadResult,
  ChannelConfig,
  Host,
  PendingApproval,
  SearchMessageResult,
  SearchMessagesFilters,
} from "./host.js";

export class PostgresHost implements Host {
  private pool: pg.Pool;

  constructor() {
    this.pool = new pg.Pool({ connectionString: config.databaseUrl });
  }

  // ── Identity & config ──

  async getAgent(id: string): Promise<Agent> {
    const { rows } = await this.pool.query(
      `SELECT a.*,
         row_to_json(ac.*) as ai_config,
         row_to_json(o.*) as organization
       FROM agents a
       LEFT JOIN ai_configs ac ON ac.agent_id = a.id
       LEFT JOIN organizations o ON o.id = a.organization_id
       WHERE a.id = $1`,
      [id],
    );
    if (!rows[0]) throw new Error(`Agent not found: ${id}`);
    return rows[0] as Agent;
  }

  async getChannelConfigs(agentId: string): Promise<ChannelConfig[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM channel_configs WHERE agent_id = $1 AND enabled = true`,
      [agentId],
    );
    return rows as ChannelConfig[];
  }

  async getSubAgents(managerId: number): Promise<SubAgent[]> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.name, a.slug, a.role, a.identity_md, a.personality_md, a.instructions_md,
         row_to_json(ac.*) as ai_config
       FROM agents a
       LEFT JOIN ai_configs ac ON ac.agent_id = a.id
       WHERE a.manager_id = $1`,
      [managerId],
    );
    return rows as SubAgent[];
  }

  // ── Conversations + messages ──

  async getConversation(id: number): Promise<Conversation | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM conversations WHERE id = $1 LIMIT 1`,
      [id],
    );
    return (rows[0] as Conversation) || null;
  }

  async findOrCreateConversation(
    agentId: number,
    orgId: number,
    kind: "internal" | "external",
    contactIdentifier: string,
    contactName?: string,
    contactEmail?: string,
    contactPhone?: string,
  ): Promise<Conversation> {
    const { rows: existing } = await this.pool.query(
      `SELECT * FROM conversations
       WHERE agent_id = $1 AND contact_identifier = $2 AND status = 'active'
       LIMIT 1`,
      [agentId, contactIdentifier],
    );
    if (existing[0]) return existing[0] as Conversation;

    const { rows: created } = await this.pool.query(
      `INSERT INTO conversations
         (organization_id, agent_id, kind, contact_identifier, contact_name, contact_email, contact_phone, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
       RETURNING *`,
      [orgId, agentId, kind, contactIdentifier, contactName || null, contactEmail || null, contactPhone || null],
    );
    return created[0] as Conversation;
  }

  async getConversationHistory(conversationId: number, limit = 20): Promise<Message[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit],
    );
    return (rows as Message[]).reverse();
  }

  async saveMessage(
    conversationId: number,
    role: "user" | "assistant" | "system",
    content: string,
    direction?: string,
    channel?: string,
    toolCalls?: unknown[],
    metadata?: Record<string, unknown>,
  ): Promise<Message> {
    const { rows } = await this.pool.query(
      `INSERT INTO messages (conversation_id, role, content, direction, channel, tool_calls, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        conversationId,
        role,
        content,
        direction || null,
        channel || null,
        JSON.stringify(toolCalls || []),
        JSON.stringify(metadata || {}),
      ],
    );

    // Bump conversation updated_at + last_message_at (needed for session rotation)
    await this.pool.query(
      `UPDATE conversations SET updated_at = NOW(), last_message_at = NOW() WHERE id = $1`,
      [conversationId],
    );

    return rows[0] as Message;
  }

  // ── Sessions + summaries ──

  async updateConversationSessionId(
    conversationId: number,
    sessionId: string | null,
    turnCount: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE conversations
       SET claude_session_id = $1, claude_session_turn_count = $2, updated_at = NOW()
       WHERE id = $3`,
      [sessionId, turnCount, conversationId],
    );
  }

  async appendConversationSummary(
    conversationId: number,
    summary: ConversationSummary,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE conversations
       SET summaries = COALESCE(summaries, '[]'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify([summary]), conversationId],
    );
  }

  // ── Approvals ──

  async savePendingApproval(
    orgId: number,
    agentId: number,
    toolName: string,
    toolInput: unknown,
    context?: string,
    messageId?: number,
  ): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO pending_approvals (organization_id, agent_id, tool_name, tool_input, context, status, message_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
       RETURNING id`,
      [orgId, agentId, toolName, JSON.stringify(toolInput || {}), context || null, messageId || null],
    );
    return rows[0].id;
  }

  async getLatestPendingApproval(agentId: number): Promise<PendingApproval | null> {
    const { rows } = await this.pool.query(
      `SELECT id, agent_id, tool_name, tool_input, status, context, message_id
       FROM pending_approvals
       WHERE agent_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      agent_id: r.agent_id,
      tool_name: r.tool_name,
      tool_input: typeof r.tool_input === "string" ? JSON.parse(r.tool_input) : r.tool_input,
      status: r.status,
      context: r.context,
      message_id: r.message_id,
    };
  }

  async updateApprovalStatus(approvalId: number, status: "approved" | "rejected"): Promise<void> {
    await this.pool.query(
      `UPDATE pending_approvals SET status = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [status, approvalId],
    );
  }

  // ── Audit + agent state ──

  async saveAuditLog(
    orgId: number,
    agentId: number,
    action: string,
    toolName?: string,
    input?: unknown,
    output?: unknown,
    status?: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (organization_id, agent_id, action, tool_name, input, output, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        orgId,
        agentId,
        action,
        toolName || null,
        JSON.stringify(input || {}),
        JSON.stringify(output || {}),
        status || null,
      ],
    );
  }

  async updateAgentMemory(agentId: number, memoryMd: string): Promise<void> {
    await this.pool.query(
      `UPDATE agents SET memory_md = $1, updated_at = NOW() WHERE id = $2`,
      [memoryMd, agentId],
    );
  }

  async updateAgentStatus(agentId: number, status: string): Promise<void> {
    await this.pool.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, agentId],
    );
  }

  // ── Scheduling ──

  async getScheduledTasks(agentId: number): Promise<ScheduledTask[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM scheduled_tasks WHERE agent_id = $1 AND active = true`,
      [agentId],
    );
    return rows as ScheduledTask[];
  }

  // ── Blob storage (Sprint 1) ──
  //
  // Bytes flow through Rails ActiveStorage. The engine doesn't run an HTTP
  // server, so we POST to Rails /api/blobs with the shared engine secret.
  // A future LocalFsHost or S3Host would implement this differently.

  async uploadBlob(
    bytes: Buffer,
    filename: string,
    contentType: string,
  ): Promise<BlobUploadResult> {
    const railsUrl = process.env.RAILS_API_URL || "http://localhost:3200";
    const secret = process.env.ENGINE_API_SECRET;
    if (!secret) {
      throw new Error("uploadBlob: ENGINE_API_SECRET not set");
    }

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch(`${railsUrl}/api/blobs`, {
      method: "POST",
      headers: { "X-Engine-Secret": secret },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`uploadBlob failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      signed_id: string;
      filename: string;
      content_type: string;
      byte_size: number;
    };
    return data;
  }

  // ── Email sending ──

  async sendEmail(payload: Record<string, unknown>): Promise<void> {
    const railsUrl = process.env.RAILS_API_URL || "http://localhost:3200";
    const secret = process.env.ENGINE_API_SECRET;
    if (!secret) throw new Error("sendEmail: ENGINE_API_SECRET not set");

    const res = await fetch(`${railsUrl}/api/send_email`, {
      method: "POST",
      headers: {
        "X-Engine-Secret": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`sendEmail failed: ${res.status} ${body}`);
    }
  }

  // ── Cross-conversation message recall (Sprint 0e) ──

  async searchMessages(filters: SearchMessagesFilters): Promise<SearchMessageResult[]> {
    // SECURITY: organizationId is mandatory. Never run a search without it.
    if (!filters.organizationId) {
      throw new Error("searchMessages: organizationId is required (tenant isolation)");
    }

    const limit = Math.min(filters.limit ?? 20, 100);
    const daysBack = filters.daysBack ?? 90;

    // Build the WHERE clause incrementally with parameterized values.
    const wheres: string[] = [
      "c.organization_id = $1",
      "m.created_at > NOW() - ($2 || ' days')::interval",
    ];
    const params: unknown[] = [filters.organizationId, String(daysBack)];

    if (filters.query) {
      // pg_trgm similarity match. % operator uses the GIN trigram index.
      params.push(filters.query);
      wheres.push(`m.content % $${params.length}`);
    }

    if (filters.contact) {
      params.push(filters.contact);
      const i = params.length;
      wheres.push(
        `(c.contact_email = $${i} OR c.contact_phone = $${i} OR c.contact_identifier = $${i} OR c.contact_name ILIKE '%' || $${i} || '%')`,
      );
    }

    if (filters.conversationId) {
      params.push(filters.conversationId);
      wheres.push(`m.conversation_id = $${params.length}`);
    }

    if (filters.channel) {
      params.push(filters.channel);
      wheres.push(`m.channel = $${params.length}`);
    }

    params.push(limit);

    // ORDER: when query is set, rank by trigram similarity (best matches first).
    // Otherwise, most recent first.
    const orderClause = filters.query
      ? `similarity(m.content, $3) DESC, m.created_at DESC`
      : `m.created_at DESC`;

    const sql = `
      SELECT
        m.conversation_id,
        m.channel,
        m.role,
        m.content,
        m.created_at,
        c.agent_id,
        c.contact_identifier,
        c.contact_name
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE ${wheres.join(" AND ")}
      ORDER BY ${orderClause}
      LIMIT $${params.length}
    `;

    const { rows } = await this.pool.query(sql, params);

    return rows.map((r): SearchMessageResult => ({
      conversation_id: r.conversation_id,
      channel: r.channel,
      contact_identifier: r.contact_identifier,
      contact_name: r.contact_name,
      role: r.role,
      content: typeof r.content === "string" ? r.content.slice(0, 500) : String(r.content).slice(0, 500),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      agent_id: r.agent_id,
    }));
  }
}
