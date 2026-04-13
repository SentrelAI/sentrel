import { Head, Link } from "@inertiajs/react"
import {
  ArrowLeft,
  MessageSquare,
  CheckSquare,
  Clock,
  User,
  Send,
  Mail,
  Phone,
  Hash,
  ArrowUpRight,
  ArrowDownLeft,
  Settings,
  Radio,
  Paperclip,
} from "lucide-react"
import { useState } from "react"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

import AppLayout from "@/layouts/app-layout"
import { AgentChat } from "@/components/agent-chat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { agentsPath, editAgentPath, agentChannelConfigsPath } from "@/routes"
import type { Agent, Task, ChannelConfig, ScheduledTask } from "@/types"

const STATUS_CONFIG: Record<string, { color: string; pulse: boolean; label: string }> = {
  running: { color: "bg-emerald-500", pulse: true, label: "Running" },
  pending: { color: "bg-amber-500", pulse: false, label: "Pending" },
  paused: { color: "bg-zinc-400", pulse: false, label: "Paused" },
  stopped: { color: "bg-red-500", pulse: false, label: "Stopped" },
  starting: { color: "bg-blue-500", pulse: true, label: "Starting" },
}

interface ConversationItem {
  id: number
  kind: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  subject: string | null
  status: string
  updated_at: string
  channel: string | null
  message_count: number
  last_message_preview: string | null
  last_message_direction: string | null
}

interface MessageAttachment {
  id: number
  filename: string
  content_type: string
  byte_size: number
  url: string
}

interface MessageItem {
  id: number
  role: "user" | "assistant" | "system"
  content: string
  direction: string | null
  channel: string | null
  metadata: Record<string, unknown>
  created_at: string
  attachments?: MessageAttachment[]
}

interface EmailItem {
  id: number
  role: string
  content: string
  direction: string
  channel: string
  created_at: string
  subject: string | null
  to: string | null
  from: string | null
  conversation_id: number
  contact: string | null
}

interface Props {
  agent: Agent
  conversations: ConversationItem[]
  emails: EmailItem[]
  chat_messages: unknown[]
  tasks: Task[]
  channel_configs: ChannelConfig[]
  scheduled_tasks: ScheduledTask[]
  approvals_by_message: Record<string, { id: number; tool_name: string; tool_input: Record<string, unknown>; status: string; created_at: string }[]>
}

type Section = "chat" | "inbox" | "tasks" | "schedule" | "identity"

const channelIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: Phone,
  telegram: Send,
  sms: Phone,
  web: MessageSquare,
  slack: Hash,
}

// ── Header bar content for this page ──
function AgentHeader({ agent }: { agent: Agent }) {
  const status = STATUS_CONFIG[agent.status] || STATUS_CONFIG.stopped

  return (
    <div className="flex items-center justify-between w-full">
      {/* Left: back + agent identity */}
      <div className="flex items-center gap-3">
        <Link
          href={agentsPath()}
          className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
        </Link>

        <div className="w-px h-4 bg-border" />

        {/* Avatar */}
        <div className="relative">
          <div className="flex size-6 items-center justify-center rounded bg-muted text-[10px] font-semibold">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5">
            <div className={`size-2 rounded-full border border-card ${status.color}`} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{agent.name}</span>
          <Badge variant="secondary" className="text-[10px]">{agent.role}</Badge>
          {agent.ai_config && (
            <span className="text-[10px] text-muted-foreground font-mono">{agent.ai_config.model_id}</span>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link href={agentChannelConfigsPath(agent.id)}>
            <Radio className="size-3 mr-1" />
            Channels
          </Link>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link href={editAgentPath(agent.id)}>
            <Settings className="size-3 mr-1" />
            Edit
          </Link>
        </Button>
      </div>
    </div>
  )
}

export default function AgentShow({ agent, conversations, emails, chat_messages, tasks, scheduled_tasks, approvals_by_message }: Props) {
  const [section, setSection] = useState<Section>("chat")
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null)
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null)
  const [channelFilter, setChannelFilter] = useState<string>("all")
  const [convMessages, setConvMessages] = useState<MessageItem[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const filteredConversations = channelFilter === "all"
    ? conversations
    : conversations.filter((c) => c.channel === channelFilter)

  const selectedConv = conversations.find((c) => c.id === selectedConvId)

  async function selectConversation(conv: ConversationItem) {
    setSelectedConvId(conv.id)
    setLoadingMessages(true)
    try {
      const res = await fetch(`/agents/${agent.id}/conversations/${conv.id}.json`)
      const data = await res.json()
      setConvMessages(data.messages || [])
    } catch {
      setConvMessages([])
    }
    setLoadingMessages(false)
  }

  const channels = [...new Set(conversations.map((c) => c.channel).filter(Boolean))]

  const tabs: { key: Section; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { key: "chat", label: "Chat", icon: Send },
    { key: "inbox", label: "Inbox", icon: MessageSquare, count: conversations.length },
    { key: "tasks", label: "Tasks", icon: CheckSquare, count: tasks.length },
    { key: "schedule", label: "Schedule", icon: Clock, count: scheduled_tasks.length },
    { key: "identity", label: "Identity", icon: User },
  ]

  return (
    <AppLayout header={<AgentHeader agent={agent} />}>
      <Head title={agent.name} />

      {/* ═══ Tabs ═══ */}
      <div className="flex items-center gap-0 border-b border-border -mx-6 px-6 -mt-6">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = section === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setSection(tab.key); setSelectedConvId(null); setSelectedEmailId(null) }}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[10px] rounded px-1.5 py-0.5 font-mono leading-none ${
                  active ? "bg-foreground/10" : "bg-muted"
                }`}>{tab.count}</span>
              )}
              {active && (
                <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-[var(--color-cyan)] rounded-t" />
              )}
            </button>
          )
        })}
      </div>

      {/* ═══ Content ═══ */}
      <div className="flex overflow-hidden -mx-6" style={{ height: "calc(100vh - 140px)" }}>
        {/* Chat */}
        {section === "chat" && (
          <div className="flex-1 overflow-hidden">
            <AgentChat agentId={agent.id} agentName={agent.name} initialMessages={chat_messages as any} approvalsByMessage={approvals_by_message} />
          </div>
        )}

        {/* Inbox — split pane */}
        {section === "inbox" && (
          <>
            {/* List pane */}
            <div className="w-80 border-r border-border flex flex-col shrink-0">
              {/* Channel filter tabs */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
                <button
                  onClick={() => { setChannelFilter("all"); setSelectedConvId(null); setSelectedEmailId(null) }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${channelFilter === "all" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  All
                </button>
                {channels.map((ch) => {
                  const Icon = channelIcon[ch!] || MessageSquare
                  return (
                    <button
                      key={ch}
                      onClick={() => { setChannelFilter(ch!); setSelectedConvId(null); setSelectedEmailId(null) }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${channelFilter === ch ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <Icon className="size-3" />
                      {ch === "email" ? "Email" : ch === "whatsapp" ? "WhatsApp" : ch === "telegram" ? "Telegram" : ch}
                    </button>
                  )
                })}
              </div>

              <div className="flex-1 overflow-y-auto">
                {channelFilter === "email" ? (
                  emails.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">No emails</div>
                  ) : (
                    emails.map((email) => {
                      const isOutbound = email.direction === "outbound"
                      const active = selectedEmailId === email.id
                      return (
                        <button
                          key={email.id}
                          onClick={() => { setSelectedEmailId(email.id); setSelectedConvId(null) }}
                          className={`w-full px-4 py-3 border-b border-border text-left transition-colors ${active ? "bg-muted/60" : "hover:bg-muted/30"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isOutbound ? (
                                <ArrowUpRight className="size-3 text-blue-500 shrink-0" />
                              ) : (
                                <ArrowDownLeft className="size-3 text-emerald-500 shrink-0" />
                              )}
                              <span className="font-medium text-xs truncate">
                                {isOutbound ? `To: ${email.to || email.contact}` : `From: ${email.contact || email.from}`}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {new Date(email.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {email.subject && (
                            <p className="text-xs font-medium mt-1 truncate">{email.subject}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5 truncate line-clamp-1">
                            {email.content.slice(0, 80)}
                          </p>
                        </button>
                      )
                    })
                  )
                ) : (
                  filteredConversations.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">No conversations</div>
                  ) : (
                    filteredConversations.map((conv) => {
                      const Icon = channelIcon[conv.channel || "web"] || MessageSquare
                      const active = selectedConvId === conv.id
                      return (
                        <button
                          key={conv.id}
                          onClick={() => { selectConversation(conv); setSelectedEmailId(null) }}
                          className={`w-full flex items-start gap-3 px-4 py-3 border-b border-border text-left transition-colors ${
                            active ? "bg-muted/60" : "hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex size-8 items-center justify-center rounded-md bg-muted shrink-0 mt-0.5">
                            <Icon className="size-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm truncate">{conv.contact_name || conv.contact_email || conv.contact_phone || "Unknown"}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{new Date(conv.updated_at).toLocaleDateString()}</span>
                            </div>
                            {conv.subject && <p className="text-xs font-medium mt-0.5 truncate">{conv.subject}</p>}
                            {conv.last_message_preview && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {conv.last_message_direction === "outbound" ? `${agent.name}: ` : ""}{conv.last_message_preview}
                              </p>
                            )}
                          </div>
                        </button>
                      )
                    })
                  )
                )}
              </div>
            </div>

            {/* Detail pane */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedEmailId && (() => {
                const email = emails.find((e) => e.id === selectedEmailId)
                if (!email) return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Email not found</div>
                const isOutbound = email.direction === "outbound"
                return (
                  <>
                    <div className="px-5 py-4 border-b border-border space-y-2">
                      <h2 className="font-semibold text-base">{email.subject || "(no subject)"}</h2>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5 text-xs">
                          <div className="flex gap-2">
                            <span className="font-medium w-10 text-muted-foreground">From</span>
                            <span>{isOutbound ? `${agent.name} <${email.from}>` : email.contact || email.from}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="font-medium w-10 text-muted-foreground">To</span>
                            <span>{isOutbound ? (email.to || email.contact) : `${agent.name} <${email.from}>`}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={isOutbound ? "default" : "secondary"} className="text-[10px]">
                            {isOutbound ? "Sent" : "Received"}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{new Date(email.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5">
                      <div className="text-sm whitespace-pre-wrap leading-relaxed max-w-2xl">{email.content}</div>
                    </div>
                  </>
                )
              })()}

              {selectedConvId && !selectedEmailId && (() => {
                const conv = selectedConv
                if (!conv) return null
                return loadingMessages ? (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
                ) : (
                  <>
                    <div className="px-5 py-3 border-b border-border">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">{conv.contact_name || conv.contact_email || conv.contact_phone || "Unknown"}</h3>
                        <Badge variant="secondary" className="text-[10px]">{conv.channel || "web"}</Badge>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                      {convMessages.map((msg) => {
                        const isOut = msg.direction === "outbound" || msg.role === "assistant"
                        return (
                          <div key={msg.id} className={`rounded-lg border border-border p-3 ${isOut ? "bg-card" : "bg-muted/30"}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                {isOut ? <ArrowUpRight className="size-3 text-blue-500" /> : <ArrowDownLeft className="size-3 text-emerald-500" />}
                                <span className="font-medium text-xs">{isOut ? agent.name : (conv.contact_name || conv.contact_email || "Contact")}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{new Date(msg.created_at).toLocaleString()}</span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {msg.attachments.map((att) => (
                                  <a
                                    key={att.id}
                                    href={att.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                    title={`${att.filename} (${formatBytes(att.byte_size)})`}
                                  >
                                    <Paperclip className="size-3" />
                                    <span className="max-w-[160px] truncate">{att.filename}</span>
                                    <span className="text-[10px] text-muted-foreground/60">{formatBytes(att.byte_size)}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {convMessages.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">No messages</div>}
                    </div>
                  </>
                )
              })()}

              {!selectedConvId && !selectedEmailId && (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                  <MessageSquare className="size-8 mb-2 opacity-20" />
                  <span className="text-sm">Select a conversation</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Tasks */}
        {section === "tasks" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <CheckSquare className="size-8 mb-2 opacity-20" />
                <span className="text-sm">No tasks assigned</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {tasks.map((task) => {
                  const statusDot: Record<string, string> = {
                    todo: "bg-zinc-400",
                    in_progress: "bg-blue-500",
                    done: "bg-emerald-500",
                    failed: "bg-red-500",
                  }
                  const priorityStyle: Record<string, string> = {
                    urgent: "text-red-500 bg-red-500/10",
                    high: "text-amber-500 bg-amber-500/10",
                    normal: "text-muted-foreground bg-muted",
                    low: "text-muted-foreground/60 bg-muted",
                  }
                  return (
                    <div key={task.id} className="flex items-center justify-between px-3 py-2.5 rounded-md border border-border hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`size-2 rounded-full ${statusDot[task.status] || "bg-zinc-400"}`} />
                        <span className="font-medium text-sm">{task.title}</span>
                        <Badge variant="secondary" className="text-[10px]">{task.status.replace("_", " ")}</Badge>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityStyle[task.priority] || ""}`}>
                          {task.priority}
                        </span>
                      </div>
                      {task.due_at && (
                        <span className="text-xs text-muted-foreground">Due {new Date(task.due_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Schedule */}
        {section === "schedule" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {scheduled_tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Clock className="size-8 mb-2 opacity-20" />
                <span className="text-sm">No scheduled tasks</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {scheduled_tasks.map((st) => (
                  <div key={st.id} className="flex items-center justify-between px-3 py-2.5 rounded-md border border-border hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`size-2 rounded-full ${st.active ? "bg-emerald-500" : "bg-zinc-400"}`} />
                      <span className="font-medium text-sm">{st.name}</span>
                      <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{st.cron_expression}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={st.active ? "default" : "secondary"} className="text-[10px]">
                        {st.active ? "Active" : "Paused"}
                      </Badge>
                      {st.last_run_at && (
                        <span className="text-[10px] text-muted-foreground">
                          Last: {new Date(st.last_run_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Identity */}
        {section === "identity" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="grid gap-3 md:grid-cols-2 max-w-4xl">
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Identity</h3>
                <pre className="text-sm whitespace-pre-wrap text-foreground/80 leading-relaxed font-sans">{agent.identity_md || "Not set"}</pre>
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Personality</h3>
                <pre className="text-sm whitespace-pre-wrap text-foreground/80 leading-relaxed font-sans">{agent.personality_md || "Not set"}</pre>
              </div>
              <div className="rounded-lg border border-border p-4 md:col-span-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Instructions</h3>
                <pre className="text-sm whitespace-pre-wrap text-foreground/80 leading-relaxed font-sans">{agent.instructions_md || "Not set"}</pre>
              </div>
              {agent.memory_md && (
                <div className="rounded-lg border border-border p-4 md:col-span-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Memory</h3>
                  <pre className="text-sm whitespace-pre-wrap text-foreground/80 leading-relaxed font-sans max-h-64 overflow-y-auto">{agent.memory_md}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
