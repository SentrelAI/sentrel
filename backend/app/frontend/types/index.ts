export interface User {
  id: string  // prefix_id (e.g. usr_...)
  name: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
}

export interface Organization {
  id: number
  name: string
  slug: string
}

export interface Auth {
  user: User | null
  organization: Organization | null
}

export interface Flash {
  success?: string
  error?: string
}

export interface MasqueradeUser {
  id: number
  name: string
  email: string
}

export interface MasqueradeState {
  admin: MasqueradeUser | null
  target: MasqueradeUser | null
}

export interface SharedProps {
  auth: Auth
  flash: Flash
  masquerade?: MasqueradeState | null
}

export interface AiConfig {
  provider: string
  model_id: string
  temperature: number
  max_tokens: number
  thinking_level: string
}

export interface AgentInstance {
  status: string
  instance_type: string
  region: string
  aws_ip_address: string | null
  provider?: string | null
  machine_id?: string | null
  public_ip?: string | null
  health_checked_at?: string | null
  started_at?: string | null
  provisioning_error?: string | null
}

export interface Agent {
  id: string  // prefix_id (e.g. agt_...)
  name: string
  slug: string
  role: string
  status: string
  identity_md: string | null
  personality_md: string | null
  instructions_md: string | null
  memory_md: string | null
  heartbeat_enabled: boolean
  heartbeat_interval_minutes: number
  permissions: Record<string, string>
  ai_config: AiConfig | null
  instance: AgentInstance | null
  manager: { id: string; name: string; slug: string } | null
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string  // prefix_id (e.g. cnv_...)
  kind: "internal" | "external"
  contact_name: string | null
  contact_email: string | null
  subject: string | null
  status: string
  updated_at: string
}

export interface Task {
  id: string  // prefix_id (e.g. tsk_...)
  title: string
  status: "todo" | "in_progress" | "done" | "failed"
  priority: "low" | "normal" | "high" | "urgent"
  due_at: string | null
  completed_at: string | null
}

export interface ChannelConfig {
  id: number
  channel_type: string
  enabled: boolean
  status: string
}

export interface ScheduledTaskRun {
  id: string  // prefix_id (log_...)
  status: string
  output: string | null
  duration_ms: number | null
  tool_calls: Array<{ name: string }>
  created_at: string
}

export interface ScheduledTask {
  id: string  // prefix_id (sch_...)
  name: string
  instruction?: string
  cron_expression: string | null
  timezone?: string
  active: boolean
  last_run_at: string | null
  mode?: "cron" | "once" | "interval"
  fire_at?: string | null
  interval_seconds?: number | null
  recent_runs?: ScheduledTaskRun[]
}

export interface AgentTemplate {
  slug: string
  name: string
  role: string
  description: string | null
  icon: string | null
  capabilities: Record<string, { enabled?: boolean; [k: string]: unknown }>
  suggested_skill_slugs: string[]
  suggested_manager_role: string | null
  suggested_provider: string | null
  suggested_model: string | null
  variables: string[]
}

export interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

export interface DashboardStats {
  total_agents: number
  running_agents: number
  pending_approvals: number
  tasks_in_progress: number
}
