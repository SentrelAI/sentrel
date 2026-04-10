import { host } from "./host/index.js";
import type { Agent } from "./types.js";
import { logger } from "./logger.js";

interface AgentDefinition {
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
}

export async function buildSubAgentDefinitions(agent: Agent): Promise<Record<string, AgentDefinition>> {
  const subAgents = await host.getSubAgents(agent.id);
  const definitions: Record<string, AgentDefinition> = {};

  for (const sub of subAgents) {
    const prompt = [
      sub.identity_md,
      sub.personality_md,
      sub.instructions_md,
    ].filter(Boolean).join("\n\n");

    definitions[sub.slug] = {
      description: `${sub.name} — ${sub.role}. Use this agent when you need help with ${sub.role.toLowerCase()} tasks. ${(sub.identity_md || "").slice(0, 200)}`,
      prompt: prompt || `You are ${sub.name}, a ${sub.role}. Complete the assigned task thoroughly.`,
      tools: ["Read", "Write", "Grep", "Glob", "Bash", "Skill"],
      model: mapModel(sub.ai_config?.model_id),
    };
  }

  if (Object.keys(definitions).length > 0) {
    logger.info(`Loaded ${Object.keys(definitions).length} sub-agent definitions`);
  }

  return definitions;
}

function mapModel(modelId?: string): string | undefined {
  if (!modelId) return undefined;
  if (modelId.includes("haiku")) return "haiku";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("opus")) return "opus";
  return undefined;
}
