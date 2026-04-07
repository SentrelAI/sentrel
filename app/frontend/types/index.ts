export interface User {
  id: number
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

export interface SharedProps {
  auth: Auth
  flash: Flash
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
}

export interface Agent {
  id: number
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
  manager: { id: number; name: string; slug: string } | null
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: number
  kind: "internal" | "external"
  contact_name: string | null
  contact_email: string | null
  subject: string | null
  status: string
  updated_at: string
}

export interface Task {
  id: number
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

export interface ScheduledTask {
  id: number
  name: string
  cron_expression: string
  active: boolean
  last_run_at: string | null
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
