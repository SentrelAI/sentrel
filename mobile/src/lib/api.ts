import type {
  Agent,
  AgentSummary,
  Message,
  OpsResult,
  Spend,
  User,
} from "./types";
import { getApiBaseUrl } from "./server";

// Backwards-compatible accessor. The base URL is now dynamic (dev/prod toggle),
// so always read it fresh per request.
export { getApiBaseUrl };

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function request<T>(
  path: string,
  opts: { method?: Method; body?: any; token?: string | null } = {}
): Promise<T> {
  const { method = "GET", body, token } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const base = getApiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e: any) {
    throw new ApiError(0, `Network error reaching ${base}. ${e?.message ?? ""}`);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      data?.error || data?.message || data?.messages?.join(", ") || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export interface LoginResponse {
  token: string;
  device_id: number;
  user: User;
  onboarding_required?: boolean;
}

export interface ConversationSummary {
  id: number;
  agent: { id: string; name: string; slug: string; role: string; status: string };
  last_message: { role: string; content: string; created_at: string } | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface OrgListItem {
  id: number;
  name: string;
  slug: string;
  role: string;
  is_current: boolean;
  onboarding_completed: boolean;
}

export const api = {
  login: (email: string, password: string, device?: { device_name?: string; platform?: string }) =>
    request<LoginResponse>("/api/mobile/login", {
      method: "POST",
      body: { email, password, ...device },
    }),

  signup: (body: {
    name: string;
    email: string;
    password: string;
    organization_name?: string;
    device_name?: string;
    platform?: string;
  }) => request<LoginResponse>("/api/mobile/signup", { method: "POST", body }),

  me: (token: string) => request<{ user: User; device_id: number }>("/api/mobile/me", { token }),

  // Organizations
  listOrgs: (token: string) =>
    request<{ organizations: OrgListItem[] }>("/api/mobile/organizations", { token }),

  switchOrg: (token: string, id: number) =>
    request<{ user: User; onboarding_required: boolean; organizations: OrgListItem[] }>(
      `/api/mobile/organizations/${id}/switch`,
      { method: "POST", token }
    ),

  createOrg: (token: string, name: string) =>
    request<{ user: User; organization: { id: number; name: string; slug: string }; onboarding_required: boolean; organizations: OrgListItem[] }>(
      "/api/mobile/organizations",
      { method: "POST", token, body: { name } }
    ),

  // Conversations inbox (Chat tab)
  listConversations: (token: string) =>
    request<{ conversations: ConversationSummary[] }>("/api/mobile/conversations", { token }),

  // Onboarding
  onboarding: (token: string) =>
    request<{ organization: any; suggested_website: string | null; analyzing: boolean }>(
      "/api/mobile/onboarding",
      { token }
    ),

  onboardingAnalyze: (token: string, website_url: string) =>
    request<{ status: string }>("/api/mobile/onboarding/analyze", {
      method: "POST",
      token,
      body: { website_url },
    }),

  onboardingComplete: (token: string) =>
    request<{ ok: boolean }>("/api/mobile/onboarding/complete", { method: "POST", token }),

  onboardingSkip: (token: string) =>
    request<{ ok: boolean }>("/api/mobile/onboarding/skip", { method: "POST", token }),

  logout: (token: string) =>
    request<void>("/api/mobile/logout", { method: "DELETE", token }),

  registerPushToken: (token: string, expo_push_token: string, platform?: string) =>
    request<{ ok: boolean }>("/api/mobile/device", {
      method: "PATCH",
      token,
      body: { expo_push_token, platform },
    }),

  testPush: (token: string) =>
    request<{ ok: boolean }>("/api/mobile/device/test_push", { method: "POST", token }),

  listAgents: (token: string) =>
    request<{ agents: AgentSummary[] }>("/api/mobile/agents", { token }),

  getAgent: (token: string, id: string) =>
    request<{ agent: Agent; spend: Spend }>(`/api/mobile/agents/${id}`, { token }),

  createAgent: (token: string, agent: Partial<Agent>, ai_config: any) =>
    request<{ agent: Agent }>("/api/mobile/agents", {
      method: "POST",
      token,
      body: { agent, ai_config },
    }),

  updateAgent: (token: string, id: string, agent: Partial<Agent>, ai_config?: any) =>
    request<{ agent: Agent }>(`/api/mobile/agents/${id}`, {
      method: "PATCH",
      token,
      body: { agent, ...(ai_config ? { ai_config } : {}) },
    }),

  deleteAgent: (token: string, id: string) =>
    request<void>(`/api/mobile/agents/${id}`, { method: "DELETE", token }),

  // Ops
  op: (token: string, id: string, action: "restart" | "reload" | "redeploy" | "reprovision") =>
    request<OpsResult>(`/api/mobile/agents/${id}/ops/${action}`, { method: "POST", token }),

  logs: (token: string, id: string, lines = 200) =>
    request<OpsResult>(`/api/mobile/agents/${id}/ops/logs?lines=${lines}`, { token }),

  // Chat
  listMessages: (token: string, id: string, limit = 50) =>
    request<{ conversation_id: number | null; messages: Message[] }>(
      `/api/mobile/agents/${id}/messages?limit=${limit}`,
      { token }
    ),

  sendMessage: (token: string, id: string, body: string) =>
    request<{ message: Message; conversation_id: number; cold_start: boolean; agent_status: string }>(
      `/api/mobile/agents/${id}/messages`,
      { method: "POST", token, body: { body } }
    ),

  pollMessages: (token: string, id: string, after: string) =>
    request<{ messages: Message[] }>(
      `/api/mobile/agents/${id}/messages/poll?after=${encodeURIComponent(after)}`,
      { token }
    ),

  markRead: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/mobile/agents/${id}/messages/read`, { method: "POST", token }),

  modelCatalog: (token: string) =>
    request<{ groups: ModelGroup[] }>("/api/mobile/model_catalog", { token }),
};

export interface ModelOptionRemote {
  provider: string;
  model_id: string;
  label: string;
  hint?: string;
}
export interface ModelGroup {
  group: string;
  options: ModelOptionRemote[];
}
