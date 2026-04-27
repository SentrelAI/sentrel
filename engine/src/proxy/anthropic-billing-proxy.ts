// Localhost HTTP proxy that lets the Claude Agent SDK talk to api.anthropic.com
// using the user's Pro/Max/Team OAuth token (instead of an API key).
//
// Why a proxy: Anthropic routes raw third-party OAuth tokens to a separate
// "extra_usage" billing pool that shows quota errors even when the user has
// full subscription quota. Claude Code itself avoids this by sending a
// specific client identifier header on every request. We replicate that here.
//
// Auth flow on every request:
//   1. SDK sends Anthropic Messages request with Authorization: Bearer <our key>.
//   2. Proxy strips the SDK-supplied Authorization, replaces with the OAuth
//      token from ANTHROPIC_OAUTH_TOKEN env (refreshed periodically by Rails
//      and pushed via AgentMachineOps.reload).
//   3. Proxy injects the Claude Code beta + identifier headers so billing
//      lands on the right pool.
//   4. Forwards to api.anthropic.com, streams response back to the SDK.
//
// The SDK only needs ANTHROPIC_BASE_URL=http://127.0.0.1:18801 set; Rails
// agent_provisioner does that for provider=anthropic_account.

import { logger } from "../logger.js";

const PROXY_PORT = 18801;
const UPSTREAM = "https://api.anthropic.com";

// Claude Code identifies itself with this beta header value. Sourced from
// public Claude Code SDK code; if Anthropic rotates it server-side we'll need
// to update.
const CLAUDE_CODE_BETA = "oauth-2025-04-20";

let server: ReturnType<typeof Bun.serve> | null = null;

export function startAnthropicBillingProxy(): void {
  if (server) {
    logger.warn("Anthropic billing proxy already running");
    return;
  }

  const oauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
  if (!oauthToken) {
    logger.warn("ANTHROPIC_OAUTH_TOKEN not set — billing proxy will not start");
    return;
  }

  server = Bun.serve({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      try {
        const url = new URL(req.url);
        const upstreamUrl = `${UPSTREAM}${url.pathname}${url.search}`;

        const headers = new Headers();
        // Carry over content-type, accept, and other non-auth headers.
        for (const [key, val] of req.headers.entries()) {
          const k = key.toLowerCase();
          if (k === "host" || k === "authorization" || k === "x-api-key") continue;
          headers.set(key, val);
        }
        // Re-read OAuth token at request time so RefreshOauthTokensJob updates
        // are picked up without restarting the proxy.
        headers.set("Authorization", `Bearer ${process.env.ANTHROPIC_OAUTH_TOKEN || oauthToken}`);
        headers.set("anthropic-version", req.headers.get("anthropic-version") || "2023-06-01");
        // Stack the existing beta header (if SDK sent one) with the OAuth
        // billing beta. Anthropic accepts comma-separated beta values.
        const sdkBeta = req.headers.get("anthropic-beta");
        headers.set("anthropic-beta", sdkBeta ? `${sdkBeta},${CLAUDE_CODE_BETA}` : CLAUDE_CODE_BETA);

        const upstreamRes = await fetch(upstreamUrl, {
          method: req.method,
          headers,
          body: req.body,
        });

        // Stream response back unchanged.
        const responseHeaders = new Headers();
        for (const [key, val] of upstreamRes.headers.entries()) {
          if (key.toLowerCase() === "content-encoding") continue;
          responseHeaders.set(key, val);
        }
        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          headers: responseHeaders,
        });
      } catch (err) {
        logger.error("Anthropic billing proxy error", { error: (err as Error).message });
        return new Response(
          JSON.stringify({ type: "error", error: { type: "proxy_error", message: (err as Error).message } }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
    },
  });

  logger.info(`Anthropic billing proxy listening on http://127.0.0.1:${PROXY_PORT}`);
}

export function stopAnthropicBillingProxy(): void {
  if (server) {
    server.stop();
    server = null;
    logger.info("Anthropic billing proxy stopped");
  }
}
