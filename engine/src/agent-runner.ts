import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import * as db from "./db.js";
import { redis } from "./queue.js";
import { syncMemoryToDb, readMemoryMd } from "./memory.js";
import { buildSubAgentDefinitions } from "./subagents.js";
import { createPermissionHook, createAuditHook } from "./permissions.js";
import { emitThinking, emitTextDelta, emitToolCall, emitToolResult, emitDone, emitError } from "./gateway.js";
import type { Agent, JobData, Message } from "./types.js";
import { logger } from "./logger.js";

export async function runAgent(agent: Agent, job: JobData): Promise<void> {
  logger.info(`Running agent: ${agent.name} (${agent.role})`, { jobType: job.type });

  // Build conversation context
  let conversationId = job.conversationId;
  let history: Message[] = [];

  // If no conversation ID, create one for inbound messages
  if (!conversationId && job.type === "inbound_message" && job.payload?.from) {
    const conversation = await db.findOrCreateConversation(
      agent.id,
      agent.organization_id,
      "external",
      job.payload.from,
      job.payload.from,
      job.payload.from.includes("@") ? job.payload.from : undefined,
      !job.payload.from.includes("@") ? job.payload.from : undefined
    );
    conversationId = conversation.id;

    // Save the inbound message
    await db.saveMessage(
      conversationId,
      "user",
      job.payload.body || "",
      "inbound",
      job.channel,
      [],
      { from: job.payload.from, subject: job.payload.subject }
    );
  }

  if (conversationId) {
    history = await db.getConversationHistory(conversationId, 20);
  }

  // Build the prompt based on job type
  const prompt = buildPrompt(agent, job, history);

  // Build sub-agent definitions from DB
  const agents = await buildSubAgentDefinitions(agent);

  // Set up OpenRouter if configured
  if (config.anthropicBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl;
  }

  const options: Record<string, unknown> = {
    cwd: config.dataDir,
    settingSources: ["project"],
    allowedTools: [
      "Skill",
      "Agent",
      "Read",
      "Write",
      "Grep",
      "Glob",
      "Bash",
      "WebSearch",
      "WebFetch",
      "Browser",
    ],
    permissionMode: "dontAsk",
  };

  // Add model if specified
  if (agent.ai_config?.model_id) {
    (options as any).model = agent.ai_config.model_id;
  }

  // Add sub-agents if any exist
  if (Object.keys(agents).length > 0) {
    (options as any).agents = agents;
  }

  try {
    let responseContent = "";

    // Broadcast: thinking
    emitThinking();

    for await (const message of query({ prompt, options: options as any })) {
      const msg = message as any;

      if (msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            responseContent = block.text;
            emitTextDelta(block.text);
          }
          if (block.type === "tool_use") {
            emitToolCall(block.name, block.input);
          }
          if (block.type === "tool_result") {
            const content = typeof block.content === "string" ? block.content : "done";
            emitToolResult(block.name || "tool", content);
          }
        }
      }

      if (msg.result) {
        responseContent = msg.result;
      }
    }

    // Broadcast: done
    emitDone(responseContent);

    // Save response to conversation
    if (conversationId && responseContent) {
      await db.saveMessage(
        conversationId,
        "assistant",
        responseContent,
        "outbound",
        job.channel
      );
    }

    // Log the action
    await db.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: prompt.slice(0, 500) },
      { response: responseContent.slice(0, 500) },
      "success"
    );

    // Sync memory back to DB (agent may have updated MEMORY.md)
    await syncMemoryToDb(agent.id);

    logger.info(`Agent run completed (${responseContent.length} chars)`);
  } catch (err) {
    emitError((err as Error).message);
    logger.error(`Agent run failed`, { error: (err as Error).message });
    await db.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: prompt.slice(0, 500) },
      { error: (err as Error).message },
      "failed"
    );
    throw err;
  }
}

function buildPrompt(agent: Agent, job: JobData, history: Message[]): string {
  const parts: string[] = [];

  // Inject memory directly into prompt
  const memory = readMemoryMd();
  if (memory && memory.trim() !== "# Memory\n\nNo memories yet.") {
    parts.push("## Your Memory (accumulated knowledge):\n" + memory + "\n");
  }
  parts.push("After this interaction, update memory/MEMORY.md with any new important facts you learn.\n");

  // Conversation history
  if (history.length > 0) {
    const senderName = job.payload?.from_name || job.payload?.from || "User";
    parts.push("## Conversation history with " + senderName + ":");
    for (const msg of history) {
      const role = msg.role === "user" ? senderName : agent.name;
      parts.push(`**${role}**: ${msg.content}`);
    }
    parts.push("");
  }

  // Current job
  switch (job.type) {
    case "inbound_message": {
      const from = job.payload?.from_name || job.payload?.from || "someone";
      const channel = job.channel || "message";
      parts.push(`New ${channel} from ${from}:`);
      if (job.payload?.subject) parts.push(`Subject: ${job.payload.subject}`);
      parts.push(`\n${job.payload?.body || ""}`);
      parts.push("\nRespond as yourself (not as an AI assistant). Use your personality and follow your instructions.");
      break;
    }

    case "heartbeat":
      parts.push(job.payload?.instruction || "Heartbeat check — anything need attention?");
      break;

    case "scheduled_task":
      parts.push(`Scheduled task: ${job.payload?.instruction || "Execute your scheduled task."}`);
      break;

    case "task_assignment":
      parts.push(`You have been assigned a task:\n${job.payload?.instruction || ""}`);
      parts.push("\nComplete this task thoroughly and report your results.");
      break;
  }

  return parts.join("\n");
}
