// PostgresHost — Host implementation backed by Postgres.
// Owns ALL SQL in the engine. Nothing outside this file should call pg.Pool directly.
//
// The schema this expects is the one the Rails app's migrations create
// (agents, conversations, messages, audit_logs, etc.), but this class doesn't
// know or care about Rails — it just speaks Postgres against a known schema.
// If we ever fork the schema, that's a new Host implementation, not a change here.

import pg from "pg";
import { CronExpressionParser } from "cron-parser";
import { config } from "../config.js";

// Compute the next fire time for a scheduled_work row. Used both on insert
// and on each fire to keep next_run_at in sync — Rails' WakeSweepJob reads
// this column to decide when to wake stopped agent machines.
//   cron     → first match of cron_expression in `timezone` after now
//   once     → fire_at itself (or null if past — Rails will skip it)
//   interval → now + interval_seconds
function computeNextRunAt(mode: string, cronExpr: string | null, tz: string | null, fireAt: Date | string | null, intervalSeconds: number | null): Date | null {
  try {
    if (mode === "cron" && cronExpr) {
      const interval = CronExpressionParser.parse(cronExpr, { tz: tz || "UTC", currentDate: new Date() });
      return interval.next().toDate();
    }
    if (mode === "once" && fireAt) {
      return new Date(fireAt);
    }
    if (mode === "interval" && intervalSeconds) {
      return new Date(Date.now() + intervalSeconds * 1000);
    }
  } catch (_err) {
    // Bad cron expression — fall through to null. The row will still be
    // visible in the DB; the engine just won't pre-wake it.
  }
  return null;
}
import type {
  Agent,
  Conversation,
  ConversationSummary,
  Message,
  ScheduledWorkItem,
  SubAgent,
} from "../types.js";
import type {
  ActivityResult,
  AgentSkill,
  AuditLogExtra,
  BlobUploadResult,
  ChannelConfig,
  Host,
  PendingApproval,
  SearchActivityFilters,
  SearchMessageResult,
  SearchMessagesFilters,
} from "./host.js";

import { railsInternalUrl } from "./rails-url.js";

// First meaningful line of an identity_md — skips blank lines + markdown
// headings. Trimmed to 180 chars so the team roster injected into the
// system prompt stays compact.
function summarizeIdentity(md: string | null | undefined): string | null {
  if (!md) return null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line.length > 180 ? line.slice(0, 177) + "..." : line;
  }
  return null;
}

export class PostgresHost implements Host {
  private pool: pg.Pool;

  constructor() {
    // Force UTC session timezone via options parameter — Rails reads
    // `timestamp without time zone` columns as UTC, so NOW() must produce UTC.
    this.pool = new pg.Pool({
      connectionString: config.databaseUrl,
      options: "-c timezone=UTC",
    });
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

  // Most recently active internal conversation for this agent. Used by
  // scheduled-task web delivery to post the agent's response back into the
  // chat tab. Matches the controller picker (order by updated_at desc).
  async getInternalConversation(agentId: number): Promise<Conversation | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM conversations
       WHERE agent_id = $1 AND kind = 'internal'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [agentId],
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
    // Item 10 — unified-conversation read. If this conversation was spliced
    // into an existing thread (different channel, same user+agent), pull
    // messages from the WHOLE unified group so the agent sees one timeline.
    // Falls back to single-conversation behaviour when unified_conversation_id
    // is NULL (the common case).
    const { rows } = await this.pool.query(
      `SELECT m.* FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.id = $1
          OR c.unified_conversation_id = (
               SELECT COALESCE(unified_conversation_id, id) FROM conversations WHERE id = $1
             )
          OR c.id = (
               SELECT COALESCE(unified_conversation_id, id) FROM conversations WHERE id = $1
             )
       ORDER BY m.created_at DESC
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

  // Generic action approvals (Item 4) — separate from email-only
  // pending_approvals usage. Sets the new columns added by
  // ExtendPendingApprovals migration.
  async createPendingActionApproval(opts: {
    orgId: number;
    agentId: number;
    summary: string;
    payloadType: string;
    payload: Record<string, unknown>;
    options: Array<{ label: string; value: string }>;
    riskTier: string;
    approvalToken: string;
    allowAmendment: boolean;
    origin?: { channel: string; metadata: Record<string, unknown>; conversationId?: number | null };
  }): Promise<{ id: number } | null> {
    const toolName = `request_approval:${opts.payloadType}`;
    const fullPayload = {
      ...opts.payload,
      _allow_amendment: opts.allowAmendment,
      _origin: opts.origin ?? null,
    };
    const { rows } = await this.pool.query(
      `INSERT INTO pending_approvals
         (organization_id, agent_id, tool_name, tool_input, context, status,
          summary, payload_type, options, risk_tier, approval_token,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING id`,
      [
        opts.orgId, opts.agentId, toolName,
        JSON.stringify(fullPayload),
        opts.summary,
        opts.summary,
        opts.payloadType,
        JSON.stringify(opts.options),
        opts.riskTier,
        opts.approvalToken,
      ],
    );
    return rows[0] ? { id: rows[0].id } : null;
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

  async getApprovalById(id: number): Promise<PendingApproval | null> {
    const { rows } = await this.pool.query(
      `SELECT id, agent_id, tool_name, tool_input, status, context, message_id
       FROM pending_approvals WHERE id = $1 LIMIT 1`,
      [id],
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

  // Used by the standing-rules auto-decide path: writes status + the
  // chosen value + (optional) free-text decision_text in one UPDATE so
  // the audit trail row reads the same as a manual decision.
  async updatePendingApprovalDecision(
    approvalId: number,
    opts: { status: "approved" | "rejected"; decision: string; decisionText?: string | null },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pending_approvals
         SET status = $1,
             decision = $2,
             decision_text = $3,
             reviewed_at = NOW(),
             updated_at = NOW()
       WHERE id = $4`,
      [opts.status, opts.decision, opts.decisionText ?? null, approvalId],
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
    extra?: AuditLogExtra,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (
        organization_id, agent_id, action, tool_name, input, output, status,
        routed_toolkits, task_id, was_resume,
        cache_read_input_tokens, cache_creation_input_tokens,
        spans, total_cost_usd, input_tokens, output_tokens,
        duration_ms, first_token_ms, model_id, job_id, conversation_id_ref,
        active_capabilities,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())`,
      [
        orgId,
        agentId,
        action,
        toolName || null,
        JSON.stringify(input || {}),
        JSON.stringify(output || {}),
        status || null,
        JSON.stringify(extra?.routedToolkits || []),
        extra?.taskId ?? null,
        extra?.wasResume ?? false,
        extra?.cacheReadInputTokens ?? null,
        extra?.cacheCreationInputTokens ?? null,
        JSON.stringify(extra?.spans ?? []),
        extra?.totalCostUsd ?? null,
        extra?.inputTokens ?? null,
        extra?.outputTokens ?? null,
        extra?.durationMs ?? null,
        extra?.firstTokenMs ?? null,
        extra?.modelId ?? null,
        extra?.jobId ?? null,
        extra?.conversationIdRef ?? null,
        JSON.stringify(extra?.activeCapabilities ?? {}),
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

  // ── Skills ──

  async getAgentSkills(agentId: number): Promise<AgentSkill[]> {
    const { rows } = await this.pool.query(
      `SELECT sd.id, sd.slug, sd.name, sd.description, sd.skill_md, sd.category,
              sd.requires_connections, sd.required_capabilities, sd.required_integrations,
              sd.system_prompt_fragment, ags.enabled
       FROM agent_skills ags
       JOIN skill_definitions sd ON sd.id = ags.skill_definition_id
       WHERE ags.agent_id = $1 AND ags.enabled = true
       ORDER BY sd.category, sd.name`,
      [agentId],
    );
    if (rows.length === 0) return [];

    // Fetch all files for the matching skills in one query, then bucket
    // them by skill id. Avoids N+1.
    const skillIds = rows.map((r) => r.id);
    const fileRes = await this.pool.query(
      `SELECT skill_definition_id, path, content, file_type, position
         FROM skill_files
        WHERE skill_definition_id = ANY($1)
        ORDER BY position ASC, path ASC`,
      [skillIds],
    );
    const filesBySkill = new Map<number, { path: string; content: string; file_type: string }[]>();
    for (const f of fileRes.rows) {
      const arr = filesBySkill.get(f.skill_definition_id) || [];
      arr.push({ path: f.path, content: f.content ?? "", file_type: f.file_type ?? "other" });
      filesBySkill.set(f.skill_definition_id, arr);
    }

    return rows.map((r): AgentSkill => {
      // Fall back to a one-element SKILL.md array when no file rows exist
      // (pre-migration data). Keeps the engine sync happy whether or not
      // skill_files has been populated.
      const files = filesBySkill.get(r.id) ?? [
        { path: "SKILL.md", content: r.skill_md ?? "", file_type: "md" },
      ];
      return {
        slug: r.slug,
        name: r.name,
        description: r.description,
        skill_md: r.skill_md,
        files,
        category: r.category,
        requires_connections: r.requires_connections || [],
        required_capabilities: r.required_capabilities || [],
        required_integrations: r.required_integrations || [],
        system_prompt_fragment: r.system_prompt_fragment || null,
        enabled: r.enabled,
      };
    });
  }

  async getAgentToolPolicies(agentId: number): Promise<Array<{
    toolkit_slug: string;
    preset: string;
    allowed_tools: string[];
    denied_tools: string[];
  }>> {
    const { rows } = await this.pool.query(
      `SELECT toolkit_slug, preset, allowed_tools, denied_tools
       FROM agent_tool_policies
       WHERE agent_id = $1`,
      [agentId],
    );
    return rows.map((r) => ({
      toolkit_slug: r.toolkit_slug,
      preset: r.preset,
      allowed_tools: Array.isArray(r.allowed_tools) ? r.allowed_tools : [],
      denied_tools: Array.isArray(r.denied_tools) ? r.denied_tools : [],
    }));
  }

  async updateAgentCommandAllowlist(agentId: number, allowlist: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE agents SET command_allowlist = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(allowlist), agentId],
    );
  }

  async enableCapability(agentId: number, key: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE agents
       SET capabilities = jsonb_set(
         coalesce(capabilities, '{}'::jsonb),
         ARRAY[$2, 'enabled'],
         'true'::jsonb,
         true
       ),
       updated_at = NOW()
       WHERE id = $1
         AND coalesce(capabilities #> ARRAY[$2, 'enabled'], 'false'::jsonb) <> 'true'::jsonb`,
      [agentId, key],
    );
    return (rowCount ?? 0) > 0;
  }

  // ── Scheduling ──

  // Layer 1 tool routing: extract tool names from recent audit log output.tool_calls
  async getMostRecentAuditLog(agentId: number, conversationId: number | null): Promise<{
    input_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  } | null> {
    let q: string;
    let params: unknown[];
    if (conversationId == null) {
      q = `SELECT input_tokens, cache_read_input_tokens, cache_creation_input_tokens
           FROM audit_logs WHERE agent_id = $1 ORDER BY id DESC LIMIT 1`;
      params = [agentId];
    } else {
      q = `SELECT input_tokens, cache_read_input_tokens, cache_creation_input_tokens
           FROM audit_logs
           WHERE agent_id = $1
             AND (output->>'conversation_id_ref' = $2 OR output->>'conversationIdRef' = $2)
           ORDER BY id DESC LIMIT 1`;
      params = [agentId, String(conversationId)];
    }
    const { rows } = await this.pool.query(q, params);
    if (rows.length === 0) return null;
    return {
      input_tokens: rows[0].input_tokens ?? null,
      cache_read_input_tokens: rows[0].cache_read_input_tokens ?? null,
      cache_creation_input_tokens: rows[0].cache_creation_input_tokens ?? null,
    };
  }

  async getRecentAuditToolCalls(agentId: number, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT output->'tool_calls' AS tool_calls FROM audit_logs
       WHERE agent_id = $1 AND output->'tool_calls' IS NOT NULL
       ORDER BY id DESC LIMIT $2`,
      [agentId, limit],
    );
    const names: string[] = [];
    for (const row of rows) {
      const calls = row.tool_calls;
      if (Array.isArray(calls)) {
        for (const tc of calls) {
          if (tc.name) names.push(tc.name);
        }
      }
    }
    return names;
  }

  // ── Step 5: scheduled_work (unified) ──

  async getScheduledWork(agentId: number): Promise<ScheduledWorkItem[]> {
    const { rows } = await this.pool.query(
      `SELECT id, mode, name, instruction, cron_expression, timezone, fire_at, interval_seconds, active, last_run_at, next_run_at, created_at, payload_extra
       FROM scheduled_work WHERE agent_id = $1 AND active = true ORDER BY created_at`,
      [agentId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      mode: r.mode,
      name: r.name,
      instruction: r.instruction,
      cron_expression: r.cron_expression,
      timezone: r.timezone || "UTC",
      fire_at: r.fire_at?.toISOString() ?? null,
      interval_seconds: r.interval_seconds,
      active: r.active,
      last_run_at: r.last_run_at?.toISOString() ?? null,
      next_run_at: r.next_run_at?.toISOString() ?? null,
      created_at: r.created_at?.toISOString() ?? null,
      payload_extra: r.payload_extra || {},
    }));
  }

  async createScheduledWork(orgId: number, agentId: number, item: Omit<ScheduledWorkItem, "id" | "last_run_at" | "next_run_at">): Promise<number> {
    // Compute next_run_at up front so Rails' WakeSweepJob (which looks at this
    // column to decide when to wake stopped machines) doesn't have to parse
    // cron expressions itself. Engine owns scheduling, Rails owns waking.
    const nextRunAt = computeNextRunAt(item.mode, item.cron_expression, item.timezone, item.fire_at, item.interval_seconds);
    const { rows } = await this.pool.query(
      `INSERT INTO scheduled_work (organization_id, agent_id, mode, name, instruction, cron_expression, timezone, fire_at, interval_seconds, active, payload_extra, next_run_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()) RETURNING id`,
      [orgId, agentId, item.mode, item.name, item.instruction, item.cron_expression, item.timezone, item.fire_at, item.interval_seconds, item.active, JSON.stringify(item.payload_extra || {}), nextRunAt],
    );
    return rows[0].id;
  }

  async updateScheduledWork(id: number, updates: Partial<Pick<ScheduledWorkItem, "name" | "instruction" | "cron_expression" | "timezone" | "fire_at" | "interval_seconds" | "active">>): Promise<void> {
    const sets: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    // Recompute next_run_at when any timing-related field changes. Cheap
    // — we already have the row's mode + new fields; cron-parser handles it.
    if (updates.cron_expression !== undefined || updates.timezone !== undefined ||
        updates.fire_at !== undefined || updates.interval_seconds !== undefined) {
      const { rows } = await this.pool.query(`SELECT mode, cron_expression, timezone, fire_at, interval_seconds FROM scheduled_work WHERE id = $1`, [id]);
      if (rows[0]) {
        const merged = { ...rows[0], ...updates };
        const nextRunAt = computeNextRunAt(merged.mode, merged.cron_expression, merged.timezone, merged.fire_at, merged.interval_seconds);
        if (nextRunAt) {
          params.push(nextRunAt);
          sets.push(`next_run_at = $${params.length}`);
        }
      }
    }
    params.push(id);
    await this.pool.query(`UPDATE scheduled_work SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  }

  async deleteScheduledWork(id: number): Promise<void> {
    await this.pool.query(`DELETE FROM scheduled_work WHERE id = $1`, [id]);
  }

  // One-shot on boot: fill in next_run_at for any active row that has NULL
  // (rows created before the engine started tracking this column, or
  // imported via Rails console). Rails WakeSweepJob keys off this column.
  async backfillScheduledWorkNextRunAt(agentId: number): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT id, mode, cron_expression, timezone, fire_at, interval_seconds
       FROM scheduled_work
       WHERE agent_id = $1 AND active = true AND next_run_at IS NULL`,
      [agentId],
    );
    if (rows.length === 0) return;
    let updated = 0;
    for (const r of rows) {
      const next = computeNextRunAt(r.mode, r.cron_expression, r.timezone, r.fire_at, r.interval_seconds);
      if (next) {
        await this.pool.query(
          `UPDATE scheduled_work SET next_run_at = $2, updated_at = NOW() WHERE id = $1`,
          [r.id, next],
        );
        updated++;
      }
    }
    if (updated > 0) {
      console.log(`[postgres] backfilled next_run_at for ${updated} scheduled_work row(s)`);
    }
  }

  async updateScheduledWorkLastRun(id: number): Promise<void> {
    // Advance next_run_at when last_run_at lands so the next sweep cycle
    // knows when to wake the machine again.
    const { rows } = await this.pool.query(`SELECT mode, cron_expression, timezone, fire_at, interval_seconds FROM scheduled_work WHERE id = $1`, [id]);
    if (!rows[0]) return;
    // A one-shot fires exactly once. Retire it (active=false) instead of
    // advancing next_run_at — otherwise next_run_at stays pinned at the
    // (now past) fire_at, the row remains active, and the 60s scheduler poll
    // re-registers + re-fires it indefinitely (runaway loop).
    if (rows[0].mode === "once") {
      await this.pool.query(
        `UPDATE scheduled_work SET last_run_at = NOW(), active = false, updated_at = NOW() WHERE id = $1`,
        [id],
      );
      return;
    }
    const nextRunAt = computeNextRunAt(rows[0].mode, rows[0].cron_expression, rows[0].timezone, rows[0].fire_at, rows[0].interval_seconds);
    await this.pool.query(
      `UPDATE scheduled_work SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW() WHERE id = $1`,
      [id, nextRunAt],
    );
  }

  // ── Tasks ──

  async createTask(orgId: number, agentId: number, title: string, opts?: { description?: string; instruction?: string; priority?: string; due_at?: string; assignedByAgentId?: number; parentTaskId?: number }): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO tasks (organization_id, agent_id, title, description, instruction, status, priority, due_at, assigned_by_agent_id, parent_task_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7, $8, $9, NOW(), NOW()) RETURNING id`,
      [
        orgId, agentId, title,
        opts?.description || null,
        opts?.instruction || null,
        opts?.priority || "normal",
        opts?.due_at || null,
        opts?.assignedByAgentId ?? null,
        opts?.parentTaskId ?? null,
      ],
    );
    const taskId = rows[0].id;
    await this.ensureTaskConversation(taskId);
    return taskId;
  }

  // Pull the first meaningful paragraph from an identity_md (skips blank lines
  // and markdown headings). Used in teammate roster to answer "what does X do?".
  // Trimmed to 180 chars so the injected roster stays tight.
  // Free function rather than class method — no state.

  // Team roster — every other agent in the same org, with manager_id so the
  // caller can split direct-reports from peers. Also returns a short summary
  // (first meaningful paragraph of identity_md) and installed skill slugs so
  // the caller knows "what each teammate is capable of" when deciding who to
  // delegate to via create_task.
  async getTeammates(orgId: number, excludeAgentId: number): Promise<Array<{ id: number; name: string; slug: string; role: string; manager_id: number | null; summary: string | null; skills: string[] }>> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.name, a.slug, a.role, a.manager_id, a.identity_md,
              COALESCE(
                (SELECT json_agg(sd.slug ORDER BY sd.slug)
                 FROM agent_skills ags
                 JOIN skill_definitions sd ON sd.id = ags.skill_definition_id
                 WHERE ags.agent_id = a.id AND ags.enabled = true),
                '[]'::json
              ) AS skill_slugs
       FROM agents a
       WHERE a.organization_id = $1 AND a.id <> $2
       ORDER BY a.name`,
      [orgId, excludeAgentId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      role: r.role,
      manager_id: r.manager_id,
      summary: summarizeIdentity(r.identity_md),
      skills: r.skill_slugs || [],
    }));
  }

  // Cross-agent targeting: resolve a slug or role to an agent in the same org.
  // Picks the first match by id when multiple agents share a role.
  async findAgentBySlugOrRole(orgId: number, slug?: string | null, role?: string | null): Promise<{ id: number; name: string; slug: string; role: string } | null> {
    if (!slug && !role) return null;
    const clauses: string[] = [];
    const params: unknown[] = [orgId];
    if (slug) { params.push(slug); clauses.push(`slug = $${params.length}`); }
    if (role) { params.push(role); clauses.push(`role ILIKE $${params.length}`); }
    const { rows } = await this.pool.query(
      `SELECT id, name, slug, role FROM agents
       WHERE organization_id = $1 AND (${clauses.join(" OR ")})
       ORDER BY id LIMIT 1`,
      params,
    );
    return rows[0] || null;
  }

  // Push a job to another agent's inbox — used by cross-agent task assignment
  // so the assignee's engine picks it up immediately rather than on next run.
  async publishInboundToAgent(targetAgentId: number, payload: {
    type: "task_assignment";
    jobId: string;
    orgId?: number;
    conversationId?: number | null;
    origin?: {
      channel: string;
      metadata: Record<string, unknown>;
      conversationId?: number | null;
    };
    payload: Record<string, unknown>;
  }): Promise<void> {
    const body = {
      type: payload.type,
      jobId: payload.jobId,
      agentId: String(targetAgentId),
      orgId: payload.orgId,
      conversationId: payload.conversationId,
      origin: payload.origin,
      payload: payload.payload,
    };
    const { redis } = await import("../queue.js");
    await redis.lpush(`agent-inbox-${targetAgentId}`, JSON.stringify(body));
  }

  private async ensureTaskConversation(taskId: number): Promise<number | null> {
    const { rows } = await this.pool.query(
      `SELECT id, organization_id, agent_id, assigned_by_user_id, title, description, instruction, conversation_id
       FROM tasks WHERE id = $1 LIMIT 1`,
      [taskId],
    );
    const task = rows[0];
    if (!task) return null;
    if (task.conversation_id) return task.conversation_id;

    const { rows: created } = await this.pool.query(
      `INSERT INTO conversations
         (organization_id, agent_id, kind, user_id, contact_identifier, contact_name, subject, status, created_at, updated_at)
       VALUES ($1, $2, 'internal', $3, $4, 'Task', $5, 'active', NOW(), NOW())
       RETURNING id`,
      [
        task.organization_id,
        task.agent_id,
        task.assigned_by_user_id || null,
        `task-${task.id}`,
        task.title,
      ],
    );
    const conversationId = created[0]?.id;
    if (!conversationId) return null;

    await this.pool.query(
      `UPDATE tasks SET conversation_id = $1, updated_at = NOW() WHERE id = $2`,
      [conversationId, taskId],
    );

    const seed = [`Task: ${task.title}`, task.description, task.instruction]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join("\n\n");
    await this.saveMessage(
      conversationId,
      "user",
      seed,
      "inbound",
      "task",
      [],
      { task_id: taskId, source: "task_created_by_engine" },
    );

    return conversationId;
  }

  async listTasks(agentId: number, status?: string): Promise<Array<{ id: number; title: string; description: string | null; status: string; priority: string; due_at: string | null; created_at: string }>> {
    const wheres = ["agent_id = $1"];
    const params: unknown[] = [agentId];
    if (status) {
      params.push(status);
      wheres.push(`status = $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT id, title, description, status, priority, due_at, created_at FROM tasks WHERE ${wheres.join(" AND ")} ORDER BY created_at DESC LIMIT 50`,
      params,
    );
    return rows;
  }

  async updateTask(id: number, updates: { status?: string; title?: string; description?: string; priority?: string; due_at?: string; result?: Record<string, unknown>; progress_summary?: string }): Promise<void> {
    const sets: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        params.push(key === "result" ? JSON.stringify(val) : val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    // Auto-set timestamps
    if (updates.status === "in_progress") sets.push("started_at = NOW()");
    if (updates.status === "done" || updates.status === "failed" || updates.status === "cancelled") sets.push("completed_at = NOW()");
    params.push(id);
    await this.pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  }

  async getTask(id: number): Promise<{ id: number; title: string; status: string; checkpoint: Record<string, unknown>; conversation_id: number | null; assigned_by_agent_id: number | null; organization_id: number; agent_id: number } | null> {
    const { rows } = await this.pool.query(
      `SELECT id, title, status, checkpoint, conversation_id, assigned_by_agent_id, organization_id, agent_id
       FROM tasks WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      checkpoint: r.checkpoint || {},
      conversation_id: r.conversation_id,
      assigned_by_agent_id: r.assigned_by_agent_id,
      organization_id: r.organization_id,
      agent_id: r.agent_id,
    };
  }

  // JSON-merge: preserves existing checkpoint keys not in the new payload.
  // Agents call this frequently on long tasks to record "I'm at 40/100", so
  // a full overwrite would lose intermediate state if they forget a key.
  async writeTaskCheckpoint(id: number, checkpoint: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE tasks SET checkpoint = COALESCE(checkpoint, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(checkpoint), id],
    );
  }

  async addTaskComment(taskId: number, agentId: number, content: string): Promise<number> {
    const conversationId = await this.ensureTaskConversation(taskId);
    if (!conversationId) throw new Error(`Task not found: ${taskId}`);

    const message = await this.saveMessage(
      conversationId,
      "assistant",
      content,
      "outbound",
      "task",
      [],
      { task_id: taskId, source: "agent_task_comment", agent_id: agentId },
    );
    await this.notifyTaskEvent(taskId, message.id).catch(() => {});
    return message.id;
  }

  private async notifyTaskEvent(taskId: number, messageId: number): Promise<void> {
    const railsUrl = process.env.RAILS_INTERNAL_URL;
    const secret = process.env.ENGINE_API_SECRET;
    if (!railsUrl || !secret) return;

    await fetch(`${railsUrl}/api/task_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Engine-Secret": secret,
      },
      body: JSON.stringify({ task_id: taskId, message_id: messageId }),
      signal: AbortSignal.timeout(2_500),
    });
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
    const url = railsInternalUrl();
    const secret = process.env.ENGINE_API_SECRET;
    if (!secret) {
      throw new Error("uploadBlob: ENGINE_API_SECRET not set");
    }

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch(`${url}/api/blobs`, {
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

  async loadBlob(signedId: string): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    const url = railsInternalUrl();
    const secret = process.env.ENGINE_API_SECRET;
    if (!secret) throw new Error("loadBlob: ENGINE_API_SECRET not set");

    const res = await fetch(`${url}/api/blobs/${encodeURIComponent(signedId)}`, {
      headers: { "X-Engine-Secret": secret },
    });

    if (!res.ok) {
      throw new Error(`loadBlob failed: ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    // Extract filename from Content-Disposition header if available
    const disposition = res.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
    const filename = filenameMatch?.[1] || `blob-${Date.now()}`;

    const arrayBuffer = await res.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), filename, contentType };
  }

  // ── Email sending ──

  async sendEmail(payload: Record<string, unknown>): Promise<void> {
    const url = railsInternalUrl();
    const secret = process.env.ENGINE_API_SECRET;
    if (!secret) throw new Error("sendEmail: ENGINE_API_SECRET not set");

    const res = await fetch(`${url}/api/send_email`, {
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

  async searchActivity(filters: SearchActivityFilters): Promise<ActivityResult[]> {
    if (!filters.organizationId) {
      throw new Error("searchActivity: organizationId is required (tenant isolation)");
    }

    const limit = Math.min(filters.limit ?? 20, 100);
    const daysBack = filters.daysBack ?? 90;

    // Build a UNION ALL across audit_logs, pending_approvals, and tasks
    // Each subquery normalizes to the same shape.

    const params: unknown[] = [filters.organizationId, String(daysBack), limit];
    const typeClauses: string[] = [];

    // Map filter type to which subqueries to include
    const includeAudit = !filters.type || ["email", "error", "tool_call"].includes(filters.type);
    const includeApprovals = !filters.type || filters.type === "approval";
    const includeTasks = !filters.type || filters.type === "task";

    const subqueries: string[] = [];

    if (includeAudit) {
      const auditWheres = [
        "a.organization_id = $1",
        "a.created_at > NOW() - ($2 || ' days')::interval",
      ];

      if (filters.agentId) {
        params.push(filters.agentId);
        auditWheres.push(`a.agent_id = $${params.length}`);
      }

      if (filters.type === "email") {
        auditWheres.push("a.action IN ('email_sent', 'email_failed', 'email_suppressed')");
      } else if (filters.type === "error") {
        auditWheres.push("a.status = 'failed'");
      } else if (filters.type === "tool_call") {
        auditWheres.push("a.tool_name IS NOT NULL");
      }

      if (filters.query) {
        params.push(`%${filters.query}%`);
        auditWheres.push(`(a.action ILIKE $${params.length} OR COALESCE(a.tool_name, '') ILIKE $${params.length} OR COALESCE(a.input::text, '') ILIKE $${params.length})`);
      }

      if (filters.contact) {
        params.push(`%${filters.contact}%`);
        auditWheres.push(`COALESCE(a.input::text, '') ILIKE $${params.length}`);
      }

      subqueries.push(`
        SELECT
          CASE
            WHEN a.action LIKE 'email%' THEN 'email_sent'
            WHEN a.status = 'failed' THEN 'error'
            ELSE 'tool_call'
          END AS type,
          a.action,
          a.agent_id,
          ag.name AS agent_name,
          COALESCE(a.status, 'unknown') AS status,
          CONCAT(a.action, CASE WHEN a.tool_name IS NOT NULL THEN ' (' || a.tool_name || ')' ELSE '' END) AS summary,
          COALESCE(a.input, '{}')::text AS details_json,
          a.created_at
        FROM audit_logs a
        LEFT JOIN agents ag ON ag.id = a.agent_id
        WHERE ${auditWheres.join(" AND ")}
      `);
    }

    if (includeApprovals) {
      const apprWheres = [
        "pa.organization_id = $1",
        "pa.created_at > NOW() - ($2 || ' days')::interval",
      ];

      if (filters.agentId) {
        // Reuse existing param or add new
        const agentParamIdx = params.indexOf(filters.agentId);
        if (agentParamIdx === -1) {
          params.push(filters.agentId);
          apprWheres.push(`pa.agent_id = $${params.length}`);
        } else {
          apprWheres.push(`pa.agent_id = $${agentParamIdx + 1}`);
        }
      }

      if (filters.query) {
        const queryParamIdx = params.findIndex((p, i) => i > 2 && typeof p === "string" && p.startsWith("%") && p.endsWith("%") && p.includes(filters.query!));
        if (queryParamIdx !== -1) {
          apprWheres.push(`(pa.tool_name ILIKE $${queryParamIdx + 1} OR COALESCE(pa.tool_input::text, '') ILIKE $${queryParamIdx + 1})`);
        }
      }

      subqueries.push(`
        SELECT
          'approval' AS type,
          CONCAT('approval_', pa.status) AS action,
          pa.agent_id,
          ag.name AS agent_name,
          pa.status,
          CONCAT(pa.tool_name, ' → ', pa.status) AS summary,
          COALESCE(pa.tool_input, '{}')::text AS details_json,
          pa.created_at
        FROM pending_approvals pa
        LEFT JOIN agents ag ON ag.id = pa.agent_id
        WHERE ${apprWheres.join(" AND ")}
      `);
    }

    if (includeTasks) {
      const taskWheres = [
        "t.organization_id = $1",
        "t.created_at > NOW() - ($2 || ' days')::interval",
      ];

      if (filters.agentId) {
        const agentParamIdx = params.findIndex((p, i) => i > 2 && p === filters.agentId);
        if (agentParamIdx !== -1) {
          taskWheres.push(`t.agent_id = $${agentParamIdx + 1}`);
        } else {
          params.push(filters.agentId);
          taskWheres.push(`t.agent_id = $${params.length}`);
        }
      }

      if (filters.query) {
        const queryParamIdx = params.findIndex((p, i) => i > 2 && typeof p === "string" && p.startsWith("%") && p.endsWith("%") && p.includes(filters.query!));
        if (queryParamIdx !== -1) {
          taskWheres.push(`(t.title ILIKE $${queryParamIdx + 1} OR COALESCE(t.description, '') ILIKE $${queryParamIdx + 1})`);
        }
      }

      subqueries.push(`
        SELECT
          'task' AS type,
          CONCAT('task_', t.status) AS action,
          t.agent_id,
          ag.name AS agent_name,
          t.status,
          CONCAT(t.title, ' → ', t.status) AS summary,
          json_build_object('title', t.title, 'description', t.description, 'priority', t.priority, 'due_at', t.due_at)::text AS details_json,
          t.created_at
        FROM tasks t
        LEFT JOIN agents ag ON ag.id = t.agent_id
        WHERE ${taskWheres.join(" AND ")}
      `);
    }

    if (subqueries.length === 0) return [];

    const sql = `
      SELECT * FROM (
        ${subqueries.join("\nUNION ALL\n")}
      ) combined
      ORDER BY created_at DESC
      LIMIT $3
    `;

    const { rows } = await this.pool.query(sql, params);

    return rows.map((r): ActivityResult => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(r.details_json || "{}"); } catch { /* ignore */ }

      return {
        type: r.type,
        action: r.action,
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        status: r.status,
        summary: r.summary,
        details,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      };
    });
  }
}
