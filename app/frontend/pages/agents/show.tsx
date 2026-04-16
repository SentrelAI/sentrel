import { Head, Link, router } from "@inertiajs/react"
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
  FileText,
  Brain,
  Sparkles,
  BookOpen,
  PenLine,
  Save,
  Check,
} from "lucide-react"
import { useState, useCallback, useRef } from "react"
import { Plus, Trash2, Pause, Play, X as XIcon, ChevronsUpDown } from "lucide-react"

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
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

interface SkillItem {
  id: number
  slug: string
  name: string
  description: string
  category: string
  icon: string
  requires_connections: string[]
  enabled?: boolean
  agent_skill_id?: number
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
  installed_skills: SkillItem[]
  available_skills: SkillItem[]
}

type Section = "chat" | "inbox" | "tasks" | "schedule" | "skills" | "identity"

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

// ── Identity editor: file tree on left, markdown editor on right ──

interface IdentityFile {
  key: string
  label: string
  icon: typeof FileText
  field: "identity_md" | "personality_md" | "instructions_md" | "memory_md" | "email_signature_md"
  description: string
  placeholder: string
  readonly?: boolean
  charLimit?: number
}

const IDENTITY_FILES: IdentityFile[] = [
  {
    key: "soul",
    label: "SOUL.md",
    icon: FileText,
    field: "identity_md",
    description: "The agent's core identity — who they are, their role, background, and purpose.",
    placeholder: "I am Alex, an SDR (Sales Development Representative) at ScribeMD. My email is alex@alchemy.scribemd.ai. I help with outreach, lead qualification, and scheduling meetings.",
  },
  {
    key: "personality",
    label: "PERSONALITY.md",
    icon: Sparkles,
    field: "personality_md",
    description: "How the agent communicates — tone, style, mannerisms, voice.",
    placeholder: "Professional but friendly. I keep emails concise and personalized. I always research the prospect before reaching out. I never say I am an AI or Claude — I am Alex.",
  },
  {
    key: "instructions",
    label: "INSTRUCTIONS.md",
    icon: BookOpen,
    field: "instructions_md",
    description: "What the agent should do — workflows, rules, constraints, priorities.",
    placeholder: "Search for leads, draft outreach emails, follow up on conversations. Always check MEMORY.md before contacting someone.",
  },
  {
    key: "memory",
    label: "MEMORY.md",
    icon: Brain,
    field: "memory_md",
    description: "Agent's accumulated knowledge. Updated by the agent automatically. Curate to stay under the limit.",
    placeholder: "# Memory\n\nNo memories yet.",
    charLimit: 2200,
  },
  {
    key: "signature",
    label: "SIGNATURE.md",
    icon: PenLine,
    field: "email_signature_md",
    description: "Email signature appended to all outbound emails.",
    placeholder: "--\nAlex\nSDR @ ScribeMD",
  },
]

function IdentityEditor({ agent }: { agent: Agent & { email_signature_md?: string | null } }) {
  const [activeFile, setActiveFile] = useState<string>("soul")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const file = IDENTITY_FILES.find((f) => f.key === activeFile)!
  const currentValue = drafts[activeFile] ?? (agent as Record<string, unknown>)[file.field] as string ?? ""
  const isDirty = drafts[activeFile] !== undefined && drafts[activeFile] !== ((agent as Record<string, unknown>)[file.field] as string ?? "")

  const handleChange = useCallback((value: string) => {
    setDrafts((prev) => ({ ...prev, [activeFile]: value }))
    setSaved(false)
  }, [activeFile])

  const handleSave = useCallback(async () => {
    if (!isDirty) return
    setSaving(true)
    router.patch(`/agents/${agent.id}`, { [file.field]: drafts[activeFile] }, {
      preserveScroll: true,
      onSuccess: () => {
        setSaving(false)
        setSaved(true)
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[activeFile]
          return next
        })
        setTimeout(() => setSaved(false), 2000)
      },
      onError: () => setSaving(false),
    })
  }, [agent.id, activeFile, file.field, drafts, isDirty])

  const charUsage = file.charLimit ? `${currentValue.length}/${file.charLimit}` : null
  const charPct = file.charLimit ? Math.round((currentValue.length / file.charLimit) * 100) : null

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: file tree */}
      <div className="w-52 shrink-0 border-r border-border overflow-y-auto bg-muted/20">
        <div className="px-3 py-2.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Agent Files</span>
        </div>
        {IDENTITY_FILES.map((f) => {
          const Icon = f.icon
          const isActive = f.key === activeFile
          const hasDraft = drafts[f.key] !== undefined
          const value = (agent as Record<string, unknown>)[f.field] as string
          const isEmpty = !value || value.trim() === ""
          return (
            <button
              key={f.key}
              onClick={() => setActiveFile(f.key)}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate text-xs">{f.label}</span>
              {hasDraft && <span className="ml-auto size-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />}
              {isEmpty && !hasDraft && <span className="ml-auto text-[9px] text-muted-foreground/50">empty</span>}
            </button>
          )
        })}
      </div>

      {/* Right: editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/10">
          <div className="flex items-center gap-2">
            <file.icon className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">{file.label}</span>
            {isDirty && <span className="text-[10px] text-amber-500 font-medium">modified</span>}
          </div>
          <div className="flex items-center gap-2">
            {charUsage && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      (charPct ?? 0) > 90 ? "bg-red-500" : (charPct ?? 0) > 70 ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, charPct ?? 0)}%` }}
                  />
                </div>
                <span>{charUsage}</span>
              </div>
            )}
            <Button
              size="sm"
              className="h-7 text-xs px-3"
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              {saving ? (
                <span className="flex items-center gap-1"><Save className="size-3 animate-pulse" /> Saving...</span>
              ) : saved ? (
                <span className="flex items-center gap-1"><Check className="size-3" /> Saved</span>
              ) : (
                <span className="flex items-center gap-1"><Save className="size-3" /> Save</span>
              )}
            </Button>
          </div>
        </div>

        {/* Description */}
        <div className="px-4 py-1.5 border-b border-border/50">
          <span className="text-[11px] text-muted-foreground">{file.description}</span>
        </div>

        {/* Textarea editor */}
        <textarea
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={file.placeholder}
          maxLength={file.charLimit}
          className="flex-1 w-full resize-none bg-transparent px-4 py-3 text-sm font-mono leading-relaxed outline-none placeholder:text-muted-foreground/40"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export default function AgentShow({ agent, conversations, emails, chat_messages, tasks, scheduled_tasks, approvals_by_message, installed_skills = [], available_skills = [] }: Props) {
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
    { key: "skills", label: "Skills", icon: Sparkles, count: installed_skills.length },
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
          <ScheduleSection agentId={agent.id} initialTasks={scheduled_tasks} />
        )}

        {/* Identity — file explorer + editor */}
        {/* Skills */}
        {section === "skills" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Installed skills */}
            <div className="mb-6">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Installed ({installed_skills.length})
              </h3>
              {installed_skills.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">No skills installed. Browse available skills below.</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {installed_skills.map((skill) => (
                    <div key={skill.slug} className="rounded-lg border border-border p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{skill.name}</span>
                          <Badge variant="secondary" className="text-[9px]">{skill.category}</Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (skill.agent_skill_id) {
                                router.delete(`/agents/${agent.id}/agent_skills/${skill.agent_skill_id}`, { preserveScroll: true })
                              }
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{skill.description}</p>
                      {skill.requires_connections.length > 0 && (
                        <div className="flex gap-1">
                          {skill.requires_connections.map((c) => (
                            <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Available skills */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Available ({available_skills.length})
              </h3>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {available_skills.map((skill) => (
                  <div key={skill.slug} className="rounded-lg border border-dashed border-border p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">{skill.name}</span>
                        <Badge variant="secondary" className="text-[9px]">{skill.category}</Badge>
                      </div>
                      <Button
                        size="sm"
                        className="h-6 text-[10px] px-3"
                        onClick={() => {
                          router.post(`/agents/${agent.id}/agent_skills`, { skill_definition_id: skill.id }, { preserveScroll: true })
                        }}
                      >
                        Install
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{skill.description}</p>
                    {skill.requires_connections.length > 0 && (
                      <div className="flex gap-1">
                        {skill.requires_connections.map((c) => (
                          <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Identity */}
        {section === "identity" && (
          <IdentityEditor agent={agent} />
        )}
      </div>
    </AppLayout>
  )
}

function ScheduleSection({ agentId, initialTasks }: { agentId: number; initialTasks: ScheduledTask[] }) {
  const [tasks, setTasks] = useState(initialTasks)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const cronRef = useRef<HTMLInputElement>(null)
  const instructionRef = useRef<HTMLTextAreaElement>(null)
  const [timezone, setTimezone] = useState("UTC")
  const [tzOpen, setTzOpen] = useState(false)

  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }

  async function handleCreate() {
    const body = {
      scheduled_task: {
        name: nameRef.current?.value || "",
        cron_expression: cronRef.current?.value || "",
        instruction: instructionRef.current?.value || "",
        timezone: timezone,
        active: true,
      },
    }
    const res = await fetch(`/agents/${agentId}/scheduled_tasks`, { method: "POST", headers, body: JSON.stringify(body) })
    if (res.ok) {
      const created = await res.json()
      setTasks((prev) => [created, ...prev])
      setShowForm(false)
    }
  }

  async function handleUpdate(id: number) {
    const body = {
      scheduled_task: {
        name: nameRef.current?.value,
        cron_expression: cronRef.current?.value,
        instruction: instructionRef.current?.value,
        timezone: timezone,
      },
    }
    const res = await fetch(`/agents/${agentId}/scheduled_tasks/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) })
    if (res.ok) {
      const updated = await res.json()
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
      setEditId(null)
    }
  }

  async function handleToggle(id: number, active: boolean) {
    const res = await fetch(`/agents/${agentId}/scheduled_tasks/${id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ scheduled_task: { active: !active } }),
    })
    if (res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, active: !active } : t)))
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/agents/${agentId}/scheduled_tasks/${id}`, { method: "DELETE", headers })
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Scheduled Tasks</h3>
        <Button size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={() => { setShowForm(!showForm); setEditId(null) }}>
          <Plus className="size-3" /> Add Schedule
        </Button>
      </div>

      {(showForm || editId) && (
        <div className="rounded-lg border bg-card p-4 mb-4 space-y-3">
          <input ref={nameRef} placeholder="Name (e.g. Weekly Report)" defaultValue={editId ? tasks.find(t => t.id === editId)?.name : ""} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Schedule</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                { label: "Every minute", cron: "* * * * *" },
                { label: "Every hour", cron: "0 * * * *" },
                { label: "Daily 9am", cron: "0 9 * * *" },
                { label: "Weekdays 9am", cron: "0 9 * * 1-5" },
                { label: "Monday 9am", cron: "0 9 * * 1" },
                { label: "Every 6 hours", cron: "0 */6 * * *" },
                { label: "1st of month", cron: "0 9 1 * *" },
              ].map((preset) => (
                <button key={preset.cron} type="button" onClick={() => { if (cronRef.current) cronRef.current.value = preset.cron }}
                  className="px-2 py-0.5 rounded border text-[11px] hover:bg-muted transition-colors">
                  {preset.label}
                </button>
              ))}
            </div>
            <input ref={cronRef} placeholder="Custom cron (e.g. 30 8 * * 1-5)" defaultValue={editId ? tasks.find(t => t.id === editId)?.cron_expression : ""} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono" />
            <p className="text-[10px] text-muted-foreground mt-1">Format: minute hour day-of-month month day-of-week</p>
          </div>

          <textarea ref={instructionRef} placeholder="Instruction — what to do when this fires..." defaultValue={editId ? tasks.find(t => t.id === editId)?.instruction || "" : ""} rows={2} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm resize-none" />

          <div className="flex items-center gap-2">
            <Popover open={tzOpen} onOpenChange={setTzOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center justify-between w-56 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                  <span className="truncate">{timezone.replace(/_/g, " ")}</span>
                  <ChevronsUpDown className="size-3 opacity-50 ml-2 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search timezone..." />
                  <CommandList className="max-h-[250px]">
                    <CommandEmpty>No timezone found.</CommandEmpty>
                    {[
                      { group: "Americas", zones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Mexico_City", "America/Argentina/Buenos_Aires", "America/Bogota", "America/Lima"] },
                      { group: "Europe", zones: ["Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Madrid", "Europe/Rome", "Europe/Zurich", "Europe/Stockholm", "Europe/Warsaw", "Europe/Moscow", "Europe/Istanbul"] },
                      { group: "Asia & Pacific", zones: ["Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Jakarta", "Asia/Manila"] },
                      { group: "Oceania & Africa", zones: ["Australia/Sydney", "Australia/Melbourne", "Australia/Perth", "Pacific/Auckland", "Pacific/Honolulu", "Africa/Cairo", "Africa/Lagos", "Africa/Johannesburg", "Africa/Nairobi"] },
                      { group: "Other", zones: ["UTC"] },
                    ].map(({ group, zones }) => (
                      <CommandGroup key={group} heading={group}>
                        {zones.map((tz) => (
                          <CommandItem key={tz} value={tz} onSelect={() => { setTimezone(tz); setTzOpen(false) }}>
                            <Check className={`size-3 mr-2 ${timezone === tz ? "opacity-100" : "opacity-0"}`} />
                            {tz.replace(/_/g, " ")}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => editId ? handleUpdate(editId) : handleCreate()}>
              {editId ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      )}

      {tasks.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Clock className="size-8 mb-2 opacity-20" />
          <span className="text-sm">No scheduled tasks</span>
          <span className="text-xs mt-1">Create one above or ask the agent to schedule something</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((st) => (
            <div key={st.id} className="rounded-md border border-border hover:bg-muted/30 transition-colors group">
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`size-2 rounded-full shrink-0 ${st.active ? "bg-emerald-500" : "bg-zinc-400"}`} />
                  <span className="font-medium text-sm truncate">{st.name}</span>
                  <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{st.cron_expression}</code>
                </div>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleToggle(st.id, st.active)} className="p-1 rounded hover:bg-muted" title={st.active ? "Pause" : "Resume"}>
                    {st.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </button>
                  <button onClick={() => setEditId(st.id)} className="p-1 rounded hover:bg-muted" title="Edit">
                    <PenLine className="size-3.5" />
                  </button>
                  <button onClick={() => handleDelete(st.id)} className="p-1 rounded hover:bg-muted text-red-500" title="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 ml-2">
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
              {(st as any).recent_runs?.length > 0 && (
                <div className="px-3 pb-2 border-t border-border/50">
                  <p className="text-[10px] text-muted-foreground mt-1.5 mb-1">Recent runs</p>
                  {(st as any).recent_runs.map((run: any) => (
                    <div key={run.id} className="flex items-start gap-2 py-1">
                      <div className={`size-1.5 rounded-full mt-1.5 shrink-0 ${run.status === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="text-[11px] text-muted-foreground flex-1 truncate">{run.output || "No output"}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{new Date(run.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
