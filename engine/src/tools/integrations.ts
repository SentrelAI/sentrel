// search_integrations MCP tool — the LLM calls this when it needs tools
// for an external service (Google Sheets, Gmail, Slack, etc).
//
// Unlike a passive "search" tool, THIS handler actually LOADS the matched
// toolkit's tools into the running agent session via Query.setMcpServers().
// The agent's next internal model turn has the newly-loaded tools — all
// within the SAME user interaction (no "try again" required).
//
// Flow:
//   1. Agent calls search_integrations({ query: "create a spreadsheet" })
//   2. Handler: embedding match → e.g. ["googlesheets"]
//   3. Handler: build Composio MCP config with googlesheets curated tools
//   4. Handler: queryRef.current.setMcpServers({ composio: newConfig })
//   5. Handler: returns "loaded GOOGLESHEETS_* tools — call them directly"
//   6. Agent's next model turn sees the new tools and calls them

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { searchToolkits, isEmbeddingReady } from "../integrations/tool-embeddings.js";
import { getActiveToolkits, buildComposioServerForToolkits } from "../integrations/composio.js";
import { routeIntegrationRequest } from "../integrations/intent-router.js";
import { logger } from "../logger.js";

// Shared state between agent-runner and this tool handler.
// agent-runner populates `current` + `baseMcpServers` after query() starts.
// The handler calls setMcpServers with the FULL set (base + composio) so
// we don't accidentally nuke recall/send-media/scheduling/tasks when
// adding a new composio toolkit.
export interface QueryState {
  current: any | null; // Query handle from the SDK
  loadedToolkits: Set<string>;
  baseMcpServers: Record<string, any>; // non-composio servers to preserve
}

export function createQueryState(): QueryState {
  return { current: null, loadedToolkits: new Set(), baseMcpServers: {} };
}

export function buildIntegrationSearchMcpServer(orgId: number, state: QueryState, userId?: number | null) {
  const searchTool = tool(
    "search_integrations",
    "Find and LOAD integration tools when you need to interact with an external service. " +
      "Examples of services: Google Sheets, Gmail, Slack, GitHub, Vercel, Apollo, HubSpot, Linear, Notion, etc. " +
      "Call this with a plain-english description of what you need to do. " +
      "The matching integration's tools will be loaded into your session and you can call them directly on your next step. " +
      "You MUST call this BEFORE trying to use any integration tool — do not guess tool names.",
    {
      query: z.string().describe(
        "Plain-english description of what you need — e.g. 'create a spreadsheet', " +
        "'send an email', 'find a contact', 'deploy to vercel', 'post to slack'"
      ),
    },
    async (args) => {
      try {
        const available = await getActiveToolkits(orgId, userId);
        if (available.length === 0) {
          return {
            content: [{ type: "text", text: "No integrations are connected for this organization." }],
            isError: true,
          };
        }

        const semanticMatches = isEmbeddingReady()
          ? await searchToolkits(args.query, available)
          : [];
        const routing = routeIntegrationRequest(args.query, available, semanticMatches);
        if (routing.errors.length > 0) {
          return {
            content: [{ type: "text", text: routing.errors.join("\n") }],
            isError: true,
          };
        }
        const matches = routing.matches;

        if (matches.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No matching integrations found for "${args.query}". Connected: ${available.join(", ")}. Try a different phrasing or describe the app name directly.`,
            }],
            isError: true,
          };
        }

        // Merge with previously-loaded toolkits so we don't lose prior tools
        const allLoaded = new Set([...state.loadedToolkits, ...matches]);

        if (!state.current) {
          logger.warn("search_integrations: query handle not available — tools will not be dynamically loaded");
          return {
            content: [{ type: "text", text: `Matched integrations: ${matches.join(", ")}. (Tools could not be dynamically loaded in this session.)` }],
            isError: true,
          };
        }

        const newToolkits = [...allLoaded];
        logger.info(`search_integrations: "${args.query}" → ${matches.join(", ")} (loaded set: ${newToolkits.join(", ")})`);

        const composioServer = await buildComposioServerForToolkits(orgId, newToolkits, userId);
        if (!composioServer) {
          return {
            content: [{ type: "text", text: `Matched ${matches.join(", ")} but failed to load tools from Composio.` }],
            isError: true,
          };
        }

        // CRITICAL: setMcpServers REPLACES the entire dynamic set. We must
        // pass ALL servers (base + composio), not just composio, or we nuke
        // recall, send-media, scheduling, tasks, and integrations itself.
        const serverSet = { ...state.baseMcpServers, composio: composioServer };
        logger.info(`search_integrations: calling setMcpServers with ${Object.keys(serverSet).length} servers: ${Object.keys(serverSet).join(", ")}`);
        const result = await state.current.setMcpServers(serverSet);
        logger.info(`search_integrations: setMcpServers returned: ${JSON.stringify(result)}`);
        if (result?.errors && Object.keys(result.errors).length > 0) {
          logger.warn("setMcpServers had errors", { errors: result.errors });
        }
        state.loadedToolkits = allLoaded;

        return {
          content: [{
            type: "text",
            text: `Loaded tools for: ${matches.join(", ")}.\n\n` +
              `You can now call tools prefixed with: ${matches.map((m) => m.toUpperCase() + "_*").join(", ")}. ` +
              `For example, Google Sheets has GOOGLESHEETS_CREATE_GOOGLE_SHEET1, GOOGLESHEETS_BATCH_UPDATE, etc. ` +
              `Proceed to call the specific tool you need.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Search failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "integrations",
    version: "0.2.0",
    tools: [searchTool],
  });
}
