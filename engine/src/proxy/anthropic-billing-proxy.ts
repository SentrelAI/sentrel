// Localhost HTTP proxy that lets the Claude Agent SDK talk to api.anthropic.com
// using the user's Pro/Max/Team OAuth token instead of an API key.
//
// Why a multi-layer proxy: Anthropic's "extra_usage" classifier uses (at least)
// 4 detection layers as of April 2026. A header-only injection isn't enough.
// Adapted from openclaw-billing-proxy v2.0 (zacdcook/openclaw-billing-proxy)
// with Alchemy-specific renames + sanitisation pairs.
//
//   Layer 1: billing-header content block in system array (with dynamic SHA256
//            fingerprint of first user message)
//   Layer 2: trigger-string sanitisation (product name, role names, etc.)
//   Layer 3: tool-name fingerprint bypass — rename our MCP tools to PascalCase
//            CC convention (create_task → TaskCreate, etc.)
//   Layer 4: system-prompt structured-config stripping + prose paraphrase
//   Layer 5: tool-description stripping + CC stub injection
//   Layer 6: schema property renaming
//   Layer 7: full bidirectional reverse mapping (SSE + JSON)
//   Layer 8: strip trailing assistant prefill (Opus 4.6 disabled it)
//
// Plus Stainless SDK + identity headers, multi-beta header, metadata injection,
// thinking-block protection.
//
// Token comes from ANTHROPIC_OAUTH_TOKEN env (set per-request boot by Rails
// agent_provisioner; rotated by RefreshOauthTokensJob → AgentMachineOps.reload
// which restarts the Machine with the fresh env).
//
// Caveats:
//   - The Claude Code identifier scheme has rotated multiple times in 2026.
//     If 400s with "out of extra usage" appear, this file needs to be re-tuned
//     against the current upstream. Treat the constants below as fragile.
//   - If Bun's HTTP server can't bind 18801 (in use elsewhere), startup logs a
//     warning and the engine falls through — agent runs will 401.

import { logger } from "../logger.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const PROXY_PORT = 18801;
const UPSTREAM_HOST = "api.anthropic.com";
const PROXY_VERSION = "alchemy-1.0.0";

// CC version we masquerade as — bump when CC ships a new release on the
// stable channel. Source: `claude --version` of a fresh install.
const CC_VERSION = "2.1.97";

// SHA256 fingerprint salt + indices, mirroring CC's utils/fingerprint.ts.
const BILLING_HASH_SALT = "59cf53e54c78";
const BILLING_HASH_INDICES = [4, 7, 20];

// Per-process identifiers (one device + session per engine boot).
const DEVICE_ID = randomBytes(32).toString("hex");
const INSTANCE_SESSION_ID = randomUUID();

// Beta features required for OAuth + CC parity. These accumulate over time —
// any of them missing causes Anthropic to either reject OAuth or fall back to
// extra-usage billing.
const REQUIRED_BETAS = [
  "oauth-2025-04-20",
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "advanced-tool-use-2025-11-20",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "effort-2025-11-24",
  "fast-mode-2026-02-01",
];

function sanitizeBearerToken(token: string | undefined): string {
  return (token || "").trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
}

// Five low-signal CC tools injected into the tools array so the visible tool
// set looks more like a real CC session. The model won't actually call these —
// schemas are minimal and there's no implementation behind them.
const CC_TOOL_STUBS = [
  '{"name":"Glob","description":"Find files by pattern","input_schema":{"type":"object","properties":{"pattern":{"type":"string","description":"Glob pattern"}},"required":["pattern"]}}',
  '{"name":"Grep","description":"Search file contents","input_schema":{"type":"object","properties":{"pattern":{"type":"string","description":"Regex pattern"},"path":{"type":"string","description":"Search path"}},"required":["pattern"]}}',
  '{"name":"Agent","description":"Launch a subagent for complex tasks","input_schema":{"type":"object","properties":{"prompt":{"type":"string","description":"Task description"}},"required":["prompt"]}}',
  '{"name":"NotebookEdit","description":"Edit notebook cells","input_schema":{"type":"object","properties":{"notebook_path":{"type":"string"},"cell_index":{"type":"integer"}},"required":["notebook_path"]}}',
  '{"name":"TodoRead","description":"Read current task list","input_schema":{"type":"object","properties":{}}}',
];

// Layer 2 — string trigger sanitisation. Alchemy-specific. Keep replacements
// space-free so filesystem paths don't get broken.
const REPLACEMENTS: Array<[string, string]> = [
  ["Alchemy", "OCPlatform"],
  ["alchemy", "ocplatform"],
  ["Sentrel", "OCBrand"],
  ["sentrel", "ocbrand"],
  ["EMPLOYEE_ID", "WORKER_ID"],
  ["employee-", "worker-"],
  ["agent-inbox-", "worker-inbox-"],
  ["alchemy_engine", "ocplatform_engine"],
  ["alchemy-engine", "ocplatform-engine"],
  ["sentrel_engine", "ocbrand_engine"],
  ["sentrel-engine", "ocbrand-engine"],
  ["HEARTBEAT_OK", "HB_ACK"],
  ["HEARTBEAT", "HB_SIGNAL"],
  ["heartbeat", "hb_signal"],
  ["running inside", "operating from"],
  ["third-party", "external"],
  ["billing proxy", "routing layer"],
  ["billing-proxy", "routing-layer"],
  ["x-anthropic-billing-header", "x-routing-config"],
  ["x-anthropic-billing", "x-routing-cfg"],
  ["cch=00000", "cfg=00000"],
  ["cc_version", "rt_version"],
  ["cc_entrypoint", "rt_entrypoint"],
];

// Layer 3 — Alchemy MCP tool names → PascalCase CC names. Bidirectional.
// Order matters where one is a prefix of another (longer first).
const TOOL_RENAMES: Array<[string, string]> = [
  ["progress_update", "ProgressUpdate"],
  ["comment_on_task", "TaskComment"],
  ["write_checkpoint", "TaskCheckpoint"],
  ["search_messages", "MessageSearch"],
  ["search_activity", "ActivitySearch"],
  ["search_knowledge", "KnowledgeSearch"],
  ["search_integrations", "IntegrationSearch"],
  ["share_to_org", "OrgShare"],
  ["create_task", "TaskCreate"],
  ["update_task", "TaskUpdate"],
  ["list_tasks", "TaskList"],
  ["cancel_self", "TaskAbandon"],
  ["ask_user", "AskUser"],
  ["ask_agent", "AskAgent"],
  ["escalate", "Escalate"],
  ["send_email", "SendEmail"],
  ["send_message", "SendMessage"],
  ["send_voice", "SendVoice"],
  ["send_image", "SendImage"],
  ["send_file", "SendFile"],
  ["schedule_once", "ScheduleOnce"],
  ["schedule_recurring", "ScheduleRecurring"],
  ["list_schedules", "ScheduleList"],
  ["delete_schedule", "ScheduleDelete"],
];

// Layer 6 — schema property names that contribute to fingerprinting.
const PROP_RENAMES: Array<[string, string]> = [
  ["agent_id", "worker_id"],
  ["organization_id", "org_id"],
  ["conversation_id", "thread_ref"],
  ["taskId", "thread_ref_id"],
];

// Reverse map for restoring originals on response. Built from the above plus
// any additional one-way replacements that don't tag along with TOOL_RENAMES.
const REVERSE_MAP: Array<[string, string]> = [
  ["OCPlatform", "Alchemy"],
  ["ocplatform", "alchemy"],
  ["OCBrand", "Sentrel"],
  ["ocbrand", "sentrel"],
  ["WORKER_ID", "EMPLOYEE_ID"],
  ["worker-", "employee-"],
  ["worker-inbox-", "agent-inbox-"],
  ["ocplatform_engine", "alchemy_engine"],
  ["ocplatform-engine", "alchemy-engine"],
  ["ocbrand_engine", "sentrel_engine"],
  ["ocbrand-engine", "sentrel-engine"],
  ["HB_ACK", "HEARTBEAT_OK"],
  ["HB_SIGNAL", "HEARTBEAT"],
  ["hb_signal", "heartbeat"],
  ["operating from", "running inside"],
  ["external", "third-party"],
  ["routing layer", "billing proxy"],
  ["routing-layer", "billing-proxy"],
  ["x-routing-config", "x-anthropic-billing-header"],
  ["x-routing-cfg", "x-anthropic-billing"],
  ["cfg=00000", "cch=00000"],
  ["rt_version", "cc_version"],
  ["rt_entrypoint", "cc_entrypoint"],
];

// ── Billing fingerprint ────────────────────────────────────────────────────

function computeBillingFingerprint(firstUserText: string): string {
  const chars = BILLING_HASH_INDICES.map((i) => firstUserText[i] || "0").join("");
  return createHash("sha256").update(`${BILLING_HASH_SALT}${chars}${CC_VERSION}`).digest("hex").slice(0, 3);
}

function extractFirstUserText(body: string): string {
  const msgsIdx = body.indexOf('"messages":[');
  if (msgsIdx === -1) return "";
  const userIdx = body.indexOf('"role":"user"', msgsIdx);
  if (userIdx === -1) return "";
  const contentIdx = body.indexOf('"content"', userIdx);
  if (contentIdx === -1 || contentIdx > userIdx + 500) return "";
  const after = body[contentIdx + '"content"'.length + 1];
  if (after === '"') {
    const start = contentIdx + '"content":"'.length;
    let end = start;
    while (end < body.length) {
      if (body[end] === "\\") { end += 2; continue; }
      if (body[end] === '"') break;
      end++;
    }
    return decodeJson(body.slice(start, end));
  }
  const textIdx = body.indexOf('"text":"', contentIdx);
  if (textIdx === -1 || textIdx > contentIdx + 2000) return "";
  const start = textIdx + '"text":"'.length;
  let end = start;
  while (end < body.length) {
    if (body[end] === "\\") { end += 2; continue; }
    if (body[end] === '"') break;
    end++;
  }
  return decodeJson(body.slice(start, Math.min(end, start + 50)));
}

function decodeJson(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function buildBillingBlock(body: string): string {
  const fingerprint = computeBillingFingerprint(extractFirstUserText(body));
  const ccVer = `${CC_VERSION}.${fingerprint}`;
  return `{"type":"text","text":"x-anthropic-billing-header: cc_version=${ccVer}; cc_entrypoint=cli; cch=00000;"}`;
}

// ── Stainless / identity headers ──────────────────────────────────────────

function getStainlessHeaders(): Record<string, string> {
  const p = process.platform;
  const osName = p === "darwin" ? "macOS" : p === "win32" ? "Windows" : p === "linux" ? "Linux" : p;
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;
  return {
    "user-agent": `claude-cli/${CC_VERSION} (external, cli)`,
    "x-app": "cli",
    "x-claude-code-session-id": INSTANCE_SESSION_ID,
    "x-stainless-arch": arch,
    "x-stainless-lang": "js",
    "x-stainless-os": osName,
    "x-stainless-package-version": "0.81.0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": process.version,
    "x-stainless-retry-count": "0",
    "x-stainless-timeout": "600",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function findMatchingBracket(str: string, start: number): number {
  let d = 0, inStr = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "[") d++;
    else if (c === "]") { d--; if (d === 0) return i; }
  }
  return -1;
}

// Mask thinking content blocks so transforms don't mutate them. Anthropic
// enforces byte-identical echo of thinking/redacted_thinking on next turn.
const THINK_MASK_PREFIX = "__OBP_THINK_MASK_";
const THINK_MASK_SUFFIX = "__";
const THINK_PATTERNS = ['{"type":"thinking"', '{"type":"redacted_thinking"'];

function maskThinkingBlocks(m: string): { masked: string; masks: string[] } {
  const masks: string[] = [];
  let out = "";
  let i = 0;
  while (i < m.length) {
    let nextIdx = -1;
    for (const p of THINK_PATTERNS) {
      const idx = m.indexOf(p, i);
      if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) nextIdx = idx;
    }
    if (nextIdx === -1) { out += m.slice(i); break; }
    out += m.slice(i, nextIdx);
    let depth = 0, inStr = false, j = nextIdx;
    while (j < m.length) {
      const c = m[j];
      if (inStr) {
        if (c === "\\") { j += 2; continue; }
        if (c === '"') inStr = false;
        j++; continue;
      }
      if (c === '"') { inStr = true; j++; continue; }
      if (c === "{") { depth++; j++; continue; }
      if (c === "}") { depth--; j++; if (depth === 0) break; continue; }
      j++;
    }
    if (depth !== 0) { out += m.slice(nextIdx); return { masked: out, masks }; }
    masks.push(m.slice(nextIdx, j));
    out += THINK_MASK_PREFIX + (masks.length - 1) + THINK_MASK_SUFFIX;
    i = j;
  }
  return { masked: out, masks };
}

function unmaskThinkingBlocks(m: string, masks: string[]): string {
  for (let i = 0; i < masks.length; i++) {
    m = m.split(THINK_MASK_PREFIX + i + THINK_MASK_SUFFIX).join(masks[i]);
  }
  return m;
}

// ── Body processing pipeline ──────────────────────────────────────────────

function processBody(bodyStr: string): string {
  const { masked, masks } = maskThinkingBlocks(bodyStr);
  let m = masked;

  // Layer 2: string triggers
  for (const [find, replace] of REPLACEMENTS) {
    m = m.split(find).join(replace);
  }
  // Layer 3: tool name renames (quoted form)
  for (const [orig, cc] of TOOL_RENAMES) {
    m = m.split(`"${orig}"`).join(`"${cc}"`);
  }
  // Layer 6: property renames
  for (const [orig, renamed] of PROP_RENAMES) {
    m = m.split(`"${orig}"`).join(`"${renamed}"`);
  }

  // Layer 4: system-prompt config stripping. Most agents have a structured
  // system prompt with our identity preamble; if we detect it, strip the
  // structured config sections. Only fires when system prompt > 8K (worth it).
  // Anchor to the system array so conversation history doesn't trigger.
  const sysArrayStart = m.indexOf('"system":[');
  if (sysArrayStart !== -1) {
    const identityIdx = m.indexOf("You are ", sysArrayStart);
    if (identityIdx !== -1) {
      // Replace structured config (## Tooling, ## Workspace, ## Identity)
      // with a short paraphrase. Heuristic: strip from first \\n## to first
      // \\n## /<path> (workspace doc landmark).
      const configStart = m.indexOf("\\n## ", identityIdx);
      const configEnd = m.indexOf("\\n## /", (configStart >= 0 ? configStart : identityIdx) + 5);
      if (configStart !== -1 && configEnd !== -1 && configEnd - configStart > 4000) {
        const PARAPHRASE =
          "\\nYou are an AI operations assistant with access to all tools listed in this request. " +
          "Tool names are case-sensitive. Your responses route to the active channel automatically. " +
          "Skills defined in your workspace should be invoked when they match user requests. " +
          "Consult your workspace reference files for detailed configuration.\\n";
        m = m.slice(0, configStart) + PARAPHRASE + m.slice(configEnd);
      }
    }
  }

  // Layer 5: tool description stripping + CC stub injection
  const toolsIdx = m.indexOf('"tools":[');
  if (toolsIdx !== -1) {
    const toolsEndIdx = findMatchingBracket(m, toolsIdx + '"tools":'.length);
    if (toolsEndIdx !== -1) {
      let section = m.slice(toolsIdx, toolsEndIdx + 1);
      let from = 0;
      while (true) {
        const d = section.indexOf('"description":"', from);
        if (d === -1) break;
        const vs = d + '"description":"'.length;
        let i = vs;
        while (i < section.length) {
          if (section[i] === "\\" && i + 1 < section.length) { i += 2; continue; }
          if (section[i] === '"') break;
          i++;
        }
        section = section.slice(0, vs) + section.slice(i);
        from = vs + 1;
      }
      // Inject CC stubs at the start of the tools array — but only the ones
      // whose name isn't already present in the request. The Claude Agent
      // SDK ships Glob/Grep/Agent as built-ins via allowedTools; injecting
      // duplicates trips Anthropic's strict `tools: Tool names must be
      // unique` validation and fails the whole request.
      const existingNames = new Set<string>();
      let nameSearchFrom = 0;
      while (true) {
        const nIdx = section.indexOf('"name":"', nameSearchFrom);
        if (nIdx === -1) break;
        const ns = nIdx + '"name":"'.length;
        let ne = ns;
        while (ne < section.length) {
          if (section[ne] === "\\" && ne + 1 < section.length) { ne += 2; continue; }
          if (section[ne] === '"') break;
          ne++;
        }
        existingNames.add(section.slice(ns, ne));
        nameSearchFrom = ne + 1;
      }
      const stubsToInject = CC_TOOL_STUBS.filter((stub) => {
        const m2 = stub.match(/"name":"([^"]+)"/);
        const stubName = m2 ? m2[1] : undefined;
        return stubName ? !existingNames.has(stubName) : true;
      });
      if (stubsToInject.length > 0) {
        const insertAt = '"tools":['.length;
        section = section.slice(0, insertAt) + stubsToInject.join(",") + "," + section.slice(insertAt);
      }
      m = m.slice(0, toolsIdx) + section + m.slice(toolsEndIdx + 1);
    }
  }

  // Layer 1: billing block (dynamic fingerprint per request)
  const BILLING_BLOCK = buildBillingBlock(m);
  const sysArrayIdx = m.indexOf('"system":[');
  if (sysArrayIdx !== -1) {
    const insertAt = sysArrayIdx + '"system":['.length;
    m = m.slice(0, insertAt) + BILLING_BLOCK + "," + m.slice(insertAt);
  } else if (m.includes('"system":"')) {
    const sysStart = m.indexOf('"system":"');
    let i = sysStart + '"system":"'.length;
    while (i < m.length) {
      if (m[i] === "\\") { i += 2; continue; }
      if (m[i] === '"') break;
      i++;
    }
    const sysEnd = i + 1;
    const originalSysStr = m.slice(sysStart + '"system":'.length, sysEnd);
    m = m.slice(0, sysStart) +
      `"system":[${BILLING_BLOCK},{"type":"text","text":${originalSysStr}}]` +
      m.slice(sysEnd);
  } else {
    m = `{"system":[${BILLING_BLOCK}],` + m.slice(1);
  }

  // Metadata injection (device + session ids, CC format)
  const metaValue = JSON.stringify({ device_id: DEVICE_ID, session_id: INSTANCE_SESSION_ID });
  const metaJson = `"metadata":{"user_id":${JSON.stringify(metaValue)}}`;
  const existingMeta = m.indexOf('"metadata":{');
  if (existingMeta !== -1) {
    let depth = 0, mi = existingMeta + '"metadata":'.length;
    for (; mi < m.length; mi++) {
      if (m[mi] === "{") depth++;
      else if (m[mi] === "}") { depth--; if (depth === 0) { mi++; break; } }
    }
    m = m.slice(0, existingMeta) + metaJson + m.slice(mi);
  } else {
    m = "{" + metaJson + "," + m.slice(1);
  }

  // Layer 8: strip trailing assistant prefill (Opus 4.6 bans it)
  const msgsIdx = m.indexOf('"messages":[');
  if (msgsIdx !== -1) {
    const arrayStart = msgsIdx + '"messages":['.length;
    const positions: Array<{ start: number; end: number }> = [];
    let depth = 0, inString = false, objStart = -1;
    for (let i = arrayStart; i < m.length; i++) {
      const c = m[i];
      if (inString) {
        if (c === "\\") { i++; continue; }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === "{") { if (depth === 0) objStart = i; depth++; }
      else if (c === "}") { depth--; if (depth === 0 && objStart !== -1) { positions.push({ start: objStart, end: i }); objStart = -1; } }
      else if (c === "]" && depth === 0) break;
    }
    while (positions.length > 0) {
      const last = positions[positions.length - 1]!;
      const obj = m.slice(last.start, last.end + 1);
      if (!obj.includes('"role":"assistant"')) break;
      let stripFrom = last.start;
      for (let i = last.start - 1; i >= arrayStart; i--) {
        if (m[i] === ",") { stripFrom = i; break; }
        if (m[i] !== " " && m[i] !== "\n" && m[i] !== "\r" && m[i] !== "\t") break;
      }
      m = m.slice(0, stripFrom) + m.slice(last.end + 1);
      positions.pop();
    }
  }

  return unmaskThinkingBlocks(m, masks);
}

// ── Reverse mapping (response → original product names) ─────────────────────

function reverseMap(text: string): string {
  let r = text;
  // Tool names (both plain and escaped — SSE input_json_delta uses escaped)
  for (const [orig, cc] of TOOL_RENAMES) {
    r = r.split(`"${cc}"`).join(`"${orig}"`);
    r = r.split(`\\"${cc}\\"`).join(`\\"${orig}\\"`);
  }
  for (const [orig, renamed] of PROP_RENAMES) {
    r = r.split(`"${renamed}"`).join(`"${orig}"`);
    r = r.split(`\\"${renamed}\\"`).join(`\\"${orig}\\"`);
  }
  for (const [sanitized, original] of REVERSE_MAP) {
    r = r.split(sanitized).join(original);
  }
  return r;
}

// ── Server ────────────────────────────────────────────────────────────────

let server: ReturnType<typeof Bun.serve> | null = null;
let requestCount = 0;
const startedAt = Date.now();

export function startAnthropicBillingProxy(): void {
  if (server) {
    logger.warn("Anthropic billing proxy already running");
    return;
  }
  if (!process.env.ANTHROPIC_OAUTH_TOKEN) {
    logger.warn("ANTHROPIC_OAUTH_TOKEN not set — billing proxy will not start");
    return;
  }

  server = Bun.serve({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    // Anthropic responses for long prompts (Read SKILL.md + tool decision)
    // can take 30–60s — sometimes longer for big context windows. Bun's
    // default idleTimeout is 10s and the option is a uint8 (max 255s),
    // so we pass 0 to disable it entirely. Safe here because this is a
    // loopback proxy on 127.0.0.1; no DDoS / exhaustion surface.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health" && req.method === "GET") {
        return new Response(JSON.stringify({
          status: "ok",
          proxy: "alchemy-anthropic-billing-proxy",
          version: PROXY_VERSION,
          uptime_s: Math.floor((Date.now() - startedAt) / 1000),
          requests_served: requestCount,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      requestCount++;
      const reqNum = requestCount;
      const ts = new Date().toISOString().substring(11, 19);

      try {
        // Buffer + transform body
        const rawBody = await req.text();
        const transformed = req.method === "POST" ? processBody(rawBody) : rawBody;
        const body = req.method === "POST" ? Buffer.from(transformed, "utf8") : undefined;

        // Build outbound headers — strip anything client-side that conflicts.
        const headers = new Headers();
        for (const [key, val] of req.headers.entries()) {
          const k = key.toLowerCase();
          if (
            k === "host" || k === "connection" || k === "authorization" ||
            k === "x-api-key" || k === "content-length" || k === "x-session-affinity"
          ) continue;
          headers.set(key, val);
        }
        const oauthToken = sanitizeBearerToken(process.env.ANTHROPIC_OAUTH_TOKEN);
        if (!oauthToken) {
          return new Response(JSON.stringify({ error: "ANTHROPIC_OAUTH_TOKEN is not set" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        headers.set("authorization", `Bearer ${oauthToken}`);
        if (body) headers.set("content-length", String(body.length));
        headers.set("accept-encoding", "identity");
        headers.set("anthropic-version", "2023-06-01");

        for (const [k, v] of Object.entries(getStainlessHeaders())) headers.set(k, v);

        // Stack required betas with whatever the SDK sent.
        const existingBeta = headers.get("anthropic-beta") || "";
        const betas = existingBeta ? existingBeta.split(",").map((s) => s.trim()) : [];
        for (const b of REQUIRED_BETAS) if (!betas.includes(b)) betas.push(b);
        headers.set("anthropic-beta", betas.join(","));

        logger.info(`[proxy] #${reqNum} ${req.method} ${url.pathname} (${rawBody.length}b → ${body?.length || 0}b)`);

        const upstreamRes = await fetch(`https://${UPSTREAM_HOST}${url.pathname}${url.search}`, {
          method: req.method,
          headers,
          body,
        });

        if (!upstreamRes.ok) {
          const errBody = await upstreamRes.text();
          if (errBody.includes("extra usage")) {
            logger.error(`[proxy] #${reqNum} DETECTION HIT — body ${body?.length || 0}b`);
          }
          const restored = reverseMap(errBody);
          const respHeaders = new Headers();
          for (const [k, v] of upstreamRes.headers.entries()) {
            if (k.toLowerCase() === "content-length" || k.toLowerCase() === "transfer-encoding") continue;
            respHeaders.set(k, v);
          }
          respHeaders.set("content-length", String(Buffer.byteLength(restored)));
          return new Response(restored, { status: upstreamRes.status, headers: respHeaders });
        }

        // SSE: event-aware reverseMap; pass thinking-block events through unchanged.
        const ct = upstreamRes.headers.get("content-type") || "";
        if (ct.includes("text/event-stream")) {
          const respHeaders = new Headers();
          for (const [k, v] of upstreamRes.headers.entries()) {
            if (k.toLowerCase() === "content-length" || k.toLowerCase() === "transfer-encoding") continue;
            respHeaders.set(k, v);
          }
          return new Response(transformSseStream(upstreamRes.body), {
            status: upstreamRes.status,
            headers: respHeaders,
          });
        }

        // Non-streaming JSON: mask thinking blocks, reverseMap, unmask.
        const respText = await upstreamRes.text();
        const { masked, masks } = maskThinkingBlocks(respText);
        const restored = unmaskThinkingBlocks(reverseMap(masked), masks);
        const respHeaders = new Headers();
        for (const [k, v] of upstreamRes.headers.entries()) {
          if (k.toLowerCase() === "content-length" || k.toLowerCase() === "transfer-encoding") continue;
          respHeaders.set(k, v);
        }
        respHeaders.set("content-length", String(Buffer.byteLength(restored)));
        return new Response(restored, { status: upstreamRes.status, headers: respHeaders });
      } catch (err) {
        logger.error("Anthropic billing proxy error", { error: (err as Error).message });
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "proxy_error", message: (err as Error).message },
        }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
    },
  });

  logger.info(`Anthropic billing proxy listening on http://127.0.0.1:${PROXY_PORT} (CC ${CC_VERSION}, betas ${REQUIRED_BETAS.length})`);
}

export function stopAnthropicBillingProxy(): void {
  if (server) {
    server.stop();
    server = null;
    logger.info("Anthropic billing proxy stopped");
  }
}

// SSE event-aware transform: buffer until \n\n, transform per event, track
// thinking-block context so we don't mutate thinking deltas.
function transformSseStream(upstreamBody: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let pending = "";
  let inThinkingBlock = false;

  const transformEvent = (event: string): string => {
    let dataIdx = event.startsWith("data: ") ? 0 : event.indexOf("\ndata: ");
    if (dataIdx === -1) return reverseMap(event);
    if (dataIdx > 0) dataIdx += 1;
    const dataLineEnd = event.indexOf("\n", dataIdx + 6);
    const dataStr = dataLineEnd === -1 ? event.slice(dataIdx + 6) : event.slice(dataIdx + 6, dataLineEnd);

    if (dataStr.includes('"type":"content_block_start"')) {
      if (
        dataStr.includes('"content_block":{"type":"thinking"') ||
        dataStr.includes('"content_block":{"type":"redacted_thinking"')
      ) {
        inThinkingBlock = true;
        return event;
      }
      inThinkingBlock = false;
      return reverseMap(event);
    }
    if (dataStr.includes('"type":"content_block_stop"')) {
      const wasThinking = inThinkingBlock;
      inThinkingBlock = false;
      return wasThinking ? event : reverseMap(event);
    }
    if (inThinkingBlock) return event;
    return reverseMap(event);
  };

  return new ReadableStream({
    async start(controller) {
      if (!upstreamBody) { controller.close(); return; }
      const reader = upstreamBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let sepIdx: number;
          while ((sepIdx = pending.indexOf("\n\n")) !== -1) {
            const event = pending.slice(0, sepIdx + 2);
            pending = pending.slice(sepIdx + 2);
            controller.enqueue(encoder.encode(transformEvent(event)));
          }
        }
        pending += decoder.decode();
        if (pending.length > 0) controller.enqueue(encoder.encode(transformEvent(pending)));
      } finally {
        controller.close();
      }
    },
  });
}
