// Localhost HTTP proxy that lets the Claude Agent SDK talk to api.openai.com's
// Responses API as if it were Anthropic Messages. Bridges the SDK's worldview
// (Anthropic Messages shape) with the user's ChatGPT Plus/Pro/Business OAuth
// token, so they can run agents on their existing subscription.
//
// Translation surface (non-streaming MVP):
//   Request:   /v1/messages → /v1/responses
//     model              ← model_id
//     system             → instructions
//     messages[]         → input[] (role + typed content blocks)
//     tools[]            → tools[] (wrap as { type: "function", function })
//     tool_use blocks    → function_call output items
//     tool_result blocks → input items with type: "function_call_output"
//   Response:  Anthropic Message ← OpenAI Response
//
// Streaming + image inputs + parallel tool calls are TODO — the agent loop
// can run in non-streaming mode as a first cut.

import { logger } from "../logger.js";

const PROXY_PORT = 18802;
const UPSTREAM = "https://api.openai.com/v1/responses";

let server: ReturnType<typeof Bun.serve> | null = null;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string | unknown[]; is_error?: boolean }
  >;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  stream?: boolean;
}

function translateMessagesRequest(body: AnthropicRequest): Record<string, unknown> {
  const input: Array<Record<string, unknown>> = [];

  for (const msg of body.messages) {
    const blocks: Array<Record<string, unknown>> = typeof msg.content === "string"
      ? [{ type: "text", text: msg.content }]
      : (msg.content as unknown as Array<Record<string, unknown>>);

    for (const block of blocks) {
      const t = block.type as string;
      if (t === "text") {
        input.push({ role: msg.role, content: [{ type: "input_text", text: block.text as string }] });
      } else if (t === "tool_use") {
        input.push({
          type: "function_call",
          call_id: block.id as string,
          name: block.name as string,
          arguments: JSON.stringify(block.input ?? {}),
        });
      } else if (t === "tool_result") {
        const c = block.content;
        const text = typeof c === "string" ? c : JSON.stringify(c);
        input.push({
          type: "function_call_output",
          call_id: block.tool_use_id as string,
          output: text,
        });
      }
    }
  }

  const tools = (body.tools || []).map((t) => ({
    type: "function",
    name: t.name,
    description: t.description || "",
    parameters: t.input_schema,
  }));

  const system = typeof body.system === "string"
    ? body.system
    : (body.system || []).map((s) => s.text).join("\n");

  const out: Record<string, unknown> = {
    model: body.model,
    input,
    max_output_tokens: body.max_tokens,
  };
  if (system) out.instructions = system;
  if (tools.length) out.tools = tools;
  if (body.tool_choice?.type === "tool" && body.tool_choice.name) {
    out.tool_choice = { type: "function", name: body.tool_choice.name };
  } else if (body.tool_choice?.type === "any") {
    out.tool_choice = "required";
  } else if (body.tool_choice?.type === "auto") {
    out.tool_choice = "auto";
  }
  return out;
}

function translateResponseToMessages(openaiRes: Record<string, unknown>): Record<string, unknown> {
  const output = (openaiRes.output as Array<Record<string, unknown>>) || [];
  const content: Array<Record<string, unknown>> = [];

  for (const item of output) {
    const itemType = item.type as string;
    if (itemType === "message") {
      const innerContent = (item.content as Array<Record<string, unknown>>) || [];
      for (const c of innerContent) {
        if (c.type === "output_text" || c.type === "text") {
          content.push({ type: "text", text: c.text as string });
        }
      }
    } else if (itemType === "function_call") {
      const argStr = item.arguments as string;
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(argStr || "{}"); } catch {}
      content.push({
        type: "tool_use",
        id: item.call_id as string,
        name: item.name as string,
        input: parsed,
      });
    }
  }

  const usage = (openaiRes.usage as Record<string, number>) || {};

  return {
    id: openaiRes.id,
    type: "message",
    role: "assistant",
    content,
    model: openaiRes.model,
    stop_reason: mapStopReason(openaiRes.status as string),
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    },
  };
}

function mapStopReason(status: string): string {
  if (status === "completed") return "end_turn";
  if (status === "incomplete") return "max_tokens";
  return "end_turn";
}

export function startOpenAITranslatorProxy(): void {
  if (server) {
    logger.warn("OpenAI translator proxy already running");
    return;
  }
  if (!process.env.OPENAI_OAUTH_TOKEN) {
    logger.warn("OPENAI_OAUTH_TOKEN not set — translator proxy will not start");
    return;
  }

  server = Bun.serve({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      try {
        const url = new URL(req.url);
        if (!url.pathname.includes("/messages")) {
          return new Response(JSON.stringify({
            type: "error",
            error: { type: "not_found", message: `Unsupported path ${url.pathname}` },
          }), { status: 404, headers: { "Content-Type": "application/json" } });
        }

        const body = await req.json() as AnthropicRequest;

        if (body.stream) {
          // Streaming-mode translation isn't implemented yet. Fail loudly so
          // the SDK falls back or surfaces the error rather than hanging.
          return new Response(JSON.stringify({
            type: "error",
            error: {
              type: "not_implemented",
              message: "OpenAI translator proxy: streaming not yet implemented. Set stream=false.",
            },
          }), { status: 501, headers: { "Content-Type": "application/json" } });
        }

        const translated = translateMessagesRequest(body);
        const upstreamRes = await fetch(UPSTREAM, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_OAUTH_TOKEN}`,
            ...(process.env.OPENAI_ACCOUNT_ID ? { "OpenAI-Organization": process.env.OPENAI_ACCOUNT_ID } : {}),
          },
          body: JSON.stringify(translated),
        });

        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          logger.error("OpenAI translator: upstream error", { status: upstreamRes.status, body: errText.slice(0, 500) });
          return new Response(JSON.stringify({
            type: "error",
            error: { type: "upstream_error", message: `OpenAI ${upstreamRes.status}: ${errText.slice(0, 500)}` },
          }), { status: upstreamRes.status, headers: { "Content-Type": "application/json" } });
        }

        const openaiRes = await upstreamRes.json() as Record<string, unknown>;
        const anthropicShape = translateResponseToMessages(openaiRes);
        return new Response(JSON.stringify(anthropicShape), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        logger.error("OpenAI translator proxy error", { error: (err as Error).message });
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "proxy_error", message: (err as Error).message },
        }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
    },
  });

  logger.info(`OpenAI translator proxy listening on http://127.0.0.1:${PROXY_PORT}`);
}

export function stopOpenAITranslatorProxy(): void {
  if (server) {
    server.stop();
    server = null;
    logger.info("OpenAI translator proxy stopped");
  }
}
