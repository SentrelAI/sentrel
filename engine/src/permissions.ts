import { host } from "./host/index.js";
import type { Agent } from "./types.js";
import { logger } from "./logger.js";

export function createPermissionHook(agent: Agent) {
  return async (input: { toolName: string; toolInput: unknown }) => {
    const level = agent.permissions?.[input.toolName] || "auto";

    if (level === "auto") {
      return undefined; // allow
    }

    if (level === "draft") {
      // Create pending approval record
      await host.savePendingApproval(
        agent.organization_id,
        agent.id,
        input.toolName,
        input.toolInput,
        `Agent ${agent.name} wants to use ${input.toolName}`
      );
      // Also log for audit trail
      await host.saveAuditLog(
        agent.organization_id,
        agent.id,
        "approval_requested",
        input.toolName,
        input.toolInput,
        null,
        "pending"
      );
      logger.info(`Action queued for approval: ${input.toolName}`);
      return { deny: true, reason: "This action requires manager approval. It has been queued for review." };
    }

    if (level === "read_only" || level === "never") {
      logger.info(`Action denied by permissions: ${input.toolName} (${level})`);
      return { deny: true, reason: `You don't have permission to use ${input.toolName}.` };
    }

    return undefined; // default: allow
  };
}

export function createAuditHook(agent: Agent) {
  return async (input: { toolName: string; toolInput: unknown }, result: unknown) => {
    await host.saveAuditLog(
      agent.organization_id,
      agent.id,
      "tool_call",
      input.toolName,
      input.toolInput,
      result,
      "success"
    );
  };
}
