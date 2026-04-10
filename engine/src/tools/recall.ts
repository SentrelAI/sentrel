// Sprint 0e — Memory recall tool
//
// Registers a `search_messages` MCP tool that the agent can call to retrieve
// older messages on demand. Backed by Postgres pg_trgm fuzzy search via the
// Host abstraction. Tenant isolation is enforced by baking the agent's
// organizationId into the handler closure at construction time — there is
// NO way for the tool's input to override which org is searched.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { host } from "../host/index.js";
import { logger } from "../logger.js";

// Build a per-agent recall MCP server. Called from agent-runner during
// buildQueryOptions, once per agent run. The orgId closure ensures the tool
// can never search across tenants.
export function buildRecallMcpServer(organizationId: number) {
  const searchMessagesTool = tool(
    "search_messages",
    "Search older messages across this agent's conversations to recall context. " +
      "Use when the user references something from a previous conversation that isn't " +
      "in your current memory or recent history. Supports fuzzy text search, contact " +
      "filter, channel filter, and date range. Results are limited and truncated.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Fuzzy text to search for in message content. Trigram-based — handles typos and partial words.",
        ),
      contact: z
        .string()
        .optional()
        .describe(
          "Filter to messages with a specific contact. Can be email, phone, name, or other identifier.",
        ),
      conversation_id: z
        .number()
        .optional()
        .describe("Filter to a single conversation by ID."),
      channel: z
        .enum(["email", "whatsapp", "telegram", "web", "slack", "sms"])
        .optional()
        .describe("Filter to messages from a specific channel."),
      days_back: z
        .number()
        .int()
        .min(1)
        .max(3650)
        .optional()
        .describe("How far back to search, in days. Default 90."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return. Default 20, max 100."),
    },
    async (args) => {
      try {
        const results = await host.searchMessages({
          organizationId, // ← baked in, NEVER from args
          query: args.query,
          contact: args.contact,
          conversationId: args.conversation_id,
          channel: args.channel,
          daysBack: args.days_back,
          limit: args.limit,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No matching messages found.",
              },
            ],
          };
        }

        const formatted = results
          .map((r, i) => {
            const who = r.contact_name || r.contact_identifier || "unknown";
            const when = new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
            const direction = r.role === "user" ? `${who} →` : `→ ${who}`;
            const channel = r.channel ? `[${r.channel}]` : "";
            return (
              `${i + 1}. ${when} ${channel} ${direction} (conv ${r.conversation_id})\n` +
              `   ${r.content}`
            );
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${results.length} message${results.length === 1 ? "" : "s"}:\n\n${formatted}`,
            },
          ],
        };
      } catch (err) {
        logger.error("recall.search_messages failed", { error: (err as Error).message });
        return {
          content: [
            {
              type: "text",
              text: `Search failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "recall",
    version: "0.1.0",
    tools: [searchMessagesTool],
  });
}
