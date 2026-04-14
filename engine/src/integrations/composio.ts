import { Composio } from "@composio/core";
import { ClaudeAgentSDKProvider } from "@composio/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";

// Creates a per-org Composio MCP server compatible with the Claude Agent SDK.
// Each org gets isolated connections — apps connected by org A are invisible
// to org B. The server is registered alongside our custom MCP servers
// (recall, send-media) in agent-runner's buildQueryOptions.

let composioClient: any = null;

function getClient(): any {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    logger.info("Composio: COMPOSIO_API_KEY not set, skipping integrations");
    return null;
  }
  if (!composioClient) {
    composioClient = new Composio({
      apiKey,
      provider: new ClaudeAgentSDKProvider(),
    });
  }
  return composioClient;
}

export async function getComposioMcpServer(orgId: number) {
  const client = getClient();
  if (!client) return null;

  try {
    const userId = `org_${orgId}`;

    // Create a session scoped to this org
    const session = await (client as any).create(userId);
    const tools = await session.tools();

    if (!tools || tools.length === 0) {
      logger.info(`Composio: no tools available for ${userId} (no apps connected)`);
      return null;
    }

    // Wrap Composio tools in a Claude Agent SDK MCP server
    const server = createSdkMcpServer({
      name: "composio",
      version: "1.0.0",
      tools,
    });

    logger.info(`Composio: ${tools.length} tools available for ${userId}`);
    return server;
  } catch (err) {
    logger.error("Composio session failed", { error: (err as Error).message });
    return null;
  }
}
