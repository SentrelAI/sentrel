import { Head, Link, router } from "@inertiajs/react"
import { ArrowLeft, Bot, MessageSquare, CheckSquare, Clock, Settings, Send, Mail, Phone, Hash, FolderOpen, User, ArrowUpRight, ArrowDownLeft } from "lucide-react"
import { useState } from "react"

import AppLayout from "@/layouts/app-layout"
import { AgentChat } from "@/components/agent-chat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { agentsPath, editAgentPath, agentChannelConfigsPath } from "@/routes"
import type { Agent, Task, ChannelConfig, ScheduledTask } from "@/types"

const statusColor: Record<string, string> = {
  running: "bg-green-500",
  pending: "bg-yellow-500",
  paused: "bg-gray-400",
  stopped: "bg-red-500",
  starting: "bg-blue-500",
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

interface MessageItem {
  id: number
  role: "user" | "assistant" | "system"
  content: string
  direction: string | null
  channel: string | null
  metadata: Record<string, unknown>
  created_at: string
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

export default function AgentShow({ agent, conversations, emails, chat_messages, tasks, channel_configs, scheduled_tasks, approvals_by_message }: Props) {
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

  // Channel tabs for inbox
  const channels = [...new Set(conversations.map((c) => c.channel).filter(Boolean))]

  const navItems = [
    { key: "chat" as Section, label: "Chat", icon: Send },
    { key: "inbox" as Section, label: "Inbox", icon: MessageSquare, count: conversations.length },
    { key: "tasks" as Section, label: "Tasks", icon: CheckSquare, count: tasks.length },
    { key: "schedule" as Section, label: "Schedule", icon: Clock, count: scheduled_tasks.length },
    { key: "identity" as Section, label: "Identity", icon: User },
  ]

  return (
    <AppLayout>
      <Head title={agent.name} />

      {/* Agent header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href={agentsPath()} className="flex size-8 items-center justify-center rounded-md hover:bg-muted transition-colors">
            <ArrowLeft className="size-4 text-muted-foreground" />
          </Link>
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Bot className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">{agent.name}</h1>
              <div className={`size-2 rounded-full ${statusColor[agent.status] || "bg-gray-400"}`} />
              <span className="text-xs text-muted-foreground capitalize">{agent.status}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{agent.role}</Badge>
              {agent.ai_config && <span className="text-[10px] text-muted-foreground font-mono">{agent.ai_config.model_id}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={agentChannelConfigsPath(agent.id)}>
              <Send className="size-3.5 mr-1.5" />
              Channels
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={editAgentPath(agent.id)}>
              <Settings className="size-3.5 mr-1.5" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      {/* Workspace layout: sidebar nav + content */}
      <div className="flex rounded-xl border border-border overflow-hidden bg-background" style={{ height: "calc(100vh - 180px)" }}>
        {/* Left sidebar nav */}
        <div className="w-48 border-r bg-muted/30 flex flex-col shrink-0">
          <nav className="flex-1 p-2 space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = section === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => { setSection(item.key); setSelectedConvId(null) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                    active
                      ? "bg-[var(--color-gold-surface)] text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className="text-[10px] bg-muted rounded px-1.5 py-0.5">{item.count}</span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Right content area */}
        <div className="flex-1 flex overflow-hidden">
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
              <div className="w-80 border-r flex flex-col shrink-0">
                {/* Channel filter tabs */}
                <div className="flex items-center gap-1 px-3 py-2 border-b">
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
                  {/* Email channel: show individual emails */}
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
                            className={`w-full px-3 py-2.5 border-b text-left transition-colors ${active ? "bg-muted/50" : "hover:bg-muted/30"}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isOutbound ? (
                                  <ArrowUpRight className="size-3 text-blue-500 shrink-0" />
                                ) : (
                                  <ArrowDownLeft className="size-3 text-green-500 shrink-0" />
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
                    /* Other channels: show conversations */
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
                            className={`w-full flex items-start gap-3 px-3 py-3 border-b text-left transition-colors ${
                              active ? "bg-muted/50" : "hover:bg-muted/30"
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
                {/* Email detail */}
                {selectedEmailId && (() => {
                  const email = emails.find((e) => e.id === selectedEmailId)
                  if (!email) return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Email not found</div>
                  const isOutbound = email.direction === "outbound"
                  return (
                    <>
                      <div className="px-5 py-4 border-b space-y-2">
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
                        <div className="text-sm whitespace-pre-wrap leading-relaxed max-w-2xl">
                          {email.content}
                        </div>
                      </div>
                    </>
                  )
                })()}

                {/* Conversation detail */}
                {selectedConvId && !selectedEmailId && (() => {
                  const conv = selectedConv
                  if (!conv) return null
                  return loadingMessages ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
                  ) : (
                    <>
                      <div className="px-4 py-3 border-b">
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium text-sm">{conv.contact_name || conv.contact_email || conv.contact_phone || "Unknown"}</h3>
                          <Badge variant="secondary" className="text-[10px]">{conv.channel || "web"}</Badge>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {convMessages.map((msg) => {
                          const isOut = msg.direction === "outbound" || msg.role === "assistant"
                          return (
                            <div key={msg.id} className={`rounded-lg border p-3 ${isOut ? "bg-card" : "bg-muted/30"}`}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5">
                                  {isOut ? <ArrowUpRight className="size-3 text-blue-500" /> : <ArrowDownLeft className="size-3 text-green-500" />}
                                  <span className="font-medium text-xs">{isOut ? agent.name : (conv.contact_name || conv.contact_email || "Contact")}</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground">{new Date(msg.created_at).toLocaleString()}</span>
                              </div>
                              <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                            </div>
                          )
                        })}
                        {convMessages.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">No messages</div>}
                      </div>
                    </>
                  )
                })()}

                {/* Empty state */}
                {!selectedConvId && !selectedEmailId && (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    Select a conversation
                  </div>
                )}
              </div>
            </>
          )}

          {/* Tasks */}
          {section === "tasks" && (
            <div className="flex-1 overflow-y-auto p-4">
              {tasks.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No tasks assigned</div>
              ) : (
                <div className="divide-y divide-border rounded-lg border">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="font-medium text-sm">{task.title}</span>
                        <Badge variant={task.status === "done" ? "default" : "secondary"} className="text-[10px]">{task.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">{task.priority}</Badge>
                      </div>
                      {task.due_at && (
                        <span className="text-xs text-muted-foreground">Due {new Date(task.due_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Schedule */}
          {section === "schedule" && (
            <div className="flex-1 overflow-y-auto p-4">
              {scheduled_tasks.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No scheduled tasks</div>
              ) : (
                <div className="divide-y divide-border rounded-lg border">
                  {scheduled_tasks.map((st) => (
                    <div key={st.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <span className="font-medium text-sm">{st.name}</span>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{st.cron_expression}</p>
                      </div>
                      <Badge variant={st.active ? "default" : "secondary"}>{st.active ? "Active" : "Paused"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Identity */}
          {section === "identity" && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-2 max-w-4xl">
                <Card>
                  <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">{agent.identity_md || "Not set"}</pre>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Personality</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">{agent.personality_md || "Not set"}</pre>
                  </CardContent>
                </Card>
                <Card className="md:col-span-2">
                  <CardHeader><CardTitle>Instructions</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">{agent.instructions_md || "Not set"}</pre>
                  </CardContent>
                </Card>
                {agent.memory_md && (
                  <Card className="md:col-span-2">
                    <CardHeader><CardTitle>Memory</CardTitle></CardHeader>
                    <CardContent>
                      <pre className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-64 overflow-y-auto">{agent.memory_md}</pre>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
