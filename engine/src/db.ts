import pg from "pg";
import { config } from "./config.js";
import type { Agent, Conversation, Message, SubAgent, ScheduledTask } from "./types.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function getAgent(id: string): Promise<Agent> {
  const { rows } = await pool.query(
    `SELECT a.*,
       row_to_json(ac.*) as ai_config,
       row_to_json(o.*) as organization
     FROM agents a
     LEFT JOIN ai_configs ac ON ac.agent_id = a.id
     LEFT JOIN organizations o ON o.id = a.organization_id
     WHERE a.id = $1`,
    [id]
  );
  if (!rows[0]) throw new Error(`Agent not found: ${id}`);
  return rows[0] as Agent;
}

export async function getChannelConfigs(agentId: string): Promise<{ channel_type: string; enabled: boolean; config: Record<string, unknown>; status: string }[]> {
  const { rows } = await pool.query(
    `SELECT * FROM channel_configs WHERE agent_id = $1 AND enabled = true`,
    [agentId]
  );
  return rows;
}

export async function getSubAgents(managerId: number): Promise<SubAgent[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.slug, a.role, a.identity_md, a.personality_md, a.instructions_md,
       row_to_json(ac.*) as ai_config
     FROM agents a
     LEFT JOIN ai_configs ac ON ac.agent_id = a.id
     WHERE a.manager_id = $1`,
    [managerId]
  );
  return rows as SubAgent[];
}

export async function getConversationHistory(conversationId: number, limit = 20): Promise<Message[]> {
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  return (rows as Message[]).reverse();
}

export async function findOrCreateConversation(
  agentId: number,
  orgId: number,
  kind: "internal" | "external",
  contactIdentifier: string,
  contactName?: string,
  contactEmail?: string,
  contactPhone?: string
): Promise<Conversation> {
  // Try to find existing
  const { rows: existing } = await pool.query(
    `SELECT * FROM conversations
     WHERE agent_id = $1 AND contact_identifier = $2 AND status = 'active'
     LIMIT 1`,
    [agentId, contactIdentifier]
  );
  if (existing[0]) return existing[0] as Conversation;

  // Create new
  const { rows: created } = await pool.query(
    `INSERT INTO conversations (organization_id, agent_id, kind, contact_identifier, contact_name, contact_email, contact_phone, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
     RETURNING *`,
    [orgId, agentId, kind, contactIdentifier, contactName || null, contactEmail || null, contactPhone || null]
  );
  return created[0] as Conversation;
}

export async function saveMessage(
  conversationId: number,
  role: "user" | "assistant" | "system",
  content: string,
  direction?: string,
  channel?: string,
  toolCalls?: unknown[],
  metadata?: Record<string, unknown>
): Promise<Message> {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, role, content, direction, channel, tool_calls, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [conversationId, role, content, direction || null, channel || null, JSON.stringify(toolCalls || []), JSON.stringify(metadata || {})]
  );

  // Update conversation timestamp
  await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);

  return rows[0] as Message;
}

export async function saveAuditLog(
  orgId: number,
  agentId: number,
  action: string,
  toolName?: string,
  input?: unknown,
  output?: unknown,
  status?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (organization_id, agent_id, action, tool_name, input, output, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [orgId, agentId, action, toolName || null, JSON.stringify(input || {}), JSON.stringify(output || {}), status || null]
  );
}

export async function savePendingApproval(
  orgId: number,
  agentId: number,
  toolName: string,
  toolInput: unknown,
  context?: string,
  messageId?: number
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO pending_approvals (organization_id, agent_id, tool_name, tool_input, context, status, message_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
     RETURNING id`,
    [orgId, agentId, toolName, JSON.stringify(toolInput || {}), context || null, messageId || null]
  );
  return rows[0].id;
}

export async function getScheduledTasks(agentId: number): Promise<ScheduledTask[]> {
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_tasks WHERE agent_id = $1 AND active = true`,
    [agentId]
  );
  return rows as ScheduledTask[];
}

export async function updateAgentMemory(agentId: number, memoryMd: string): Promise<void> {
  await pool.query(
    `UPDATE agents SET memory_md = $1, updated_at = NOW() WHERE id = $2`,
    [memoryMd, agentId]
  );
}

export async function updateAgentStatus(agentId: number, status: string): Promise<void> {
  await pool.query(
    `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, agentId]
  );
}

export { pool };
