import { query } from "@anthropic-ai/claude-agent-sdk";
import { host } from "./host/index.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { Agent, ConversationSummary } from "./types.js";

// Generates a compact summary of a conversation's prior turns. Used when a Claude
// session rotates (turn cap or time gap) so context is preserved across the rotation
// without keeping the bloated session.
//
// Returns null if the conversation has too few messages to warrant summarizing.
export async function summarizeConversation(
  agent: Agent,
  conversationId: number,
  fromTurn: number,
  toTurn: number
): Promise<ConversationSummary | null> {
  // Pull the conversation history. Cap at 100 most recent messages — anything
  // older is already covered by prior summaries.
  const messages = await host.getConversationHistory(conversationId, 100);
  if (messages.length < 5) {
    logger.info(`Summarizer: skipping conversation ${conversationId}, only ${messages.length} messages`);
    return null;
  }

  // Build a plain transcript for the summarization prompt
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Contact" : agent.name}: ${m.content}`)
    .join("\n\n");

  const systemPrompt =
    `You are a precise conversation summarizer. Given a transcript between ` +
    `${agent.name} and a contact, produce a terse factual summary in 5-10 bullet points.\n\n` +
    `Focus on:\n` +
    `- What was discussed (topics, products, deals)\n` +
    `- Decisions made and commitments\n` +
    `- Action items and their owners\n` +
    `- Key facts about the contact (role, company, budget, timeline, preferences)\n` +
    `- Any blockers or open questions\n\n` +
    `Rules:\n` +
    `- Use bullet points, not prose\n` +
    `- Skip greetings, pleasantries, and small talk\n` +
    `- Be terse and factual — no editorializing\n` +
    `- Reference specific names, dates, numbers when present\n` +
    `- If nothing meaningful happened, say so in one bullet`;

  const userPrompt = `Summarize this conversation:\n\n${transcript}`;

  // Use the SDK with no tools, no resume — pure summarization call
  const options: Record<string, unknown> = {
    cwd: config.dataDir,
    systemPrompt,
    allowedTools: [],
    permissionMode: "bypassPermissions",
  };

  if (agent.ai_config?.model_id) {
    options.model = agent.ai_config.model_id;
  }

  let summaryText = "";
  try {
    for await (const message of query({ prompt: userPrompt, options: options as any })) {
      const msg = message as any;
      if (msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            summaryText = block.text;
          }
        }
      }
      if (msg.result) {
        summaryText = msg.result;
      }
    }
  } catch (err) {
    logger.error(`Summarizer failed for conversation ${conversationId}`, { error: (err as Error).message });
    return null;
  }

  if (!summaryText.trim()) {
    logger.warn(`Summarizer returned empty result for conversation ${conversationId}`);
    return null;
  }

  return {
    summarized_at: new Date().toISOString(),
    turn_range: `${fromTurn}-${toTurn}`,
    summary: summaryText.trim(),
  };
}
