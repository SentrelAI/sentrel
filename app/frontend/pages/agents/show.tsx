import { Head, Link, router } from "@inertiajs/react"
import {
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
import { useState, useCallback, useRef, useEffect } from "react"
import { Plus, Trash2, Pause, Play, X as XIcon, ChevronsUpDown, ChevronDown } from "lucide-react"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

import { StatusDot } from "@/components/brand"
import AppLayout from "@/layouts/app-layout"
import { AgentChat } from "@/components/agent-chat"
import { AgentOpsMenu } from "@/components/agent-ops-menu"
import { AgentModelPicker } from "@/components/agent-model-picker"
import { AgentSpendCard } from "@/components/agent-spend-card"
import { DollarSign } from "lucide-react"
import KnowledgePanel, { type KnowledgeDocument } from "@/components/knowledge-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select as SelectUI, SelectContent as SelectUIContent, SelectItem as SelectUIItem, SelectTrigger as SelectUITrigger, SelectValue as SelectUIValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { agentsPath, dashboardPath, editAgentPath, agentChannelConfigsPath } from "@/routes"
import type { Agent, Task, ChannelConfig, ScheduledTask, ScheduledTaskRun } from "@/types"

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

interface SpendSummary {
  runs: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_written: number
  cost_usd: number
  top_models: Array<{ model_id: string; runs: number; cost_usd: number }>
}

interface Props {
  agent: Agent
  spend?: { today: SpendSummary; seven_day: SpendSummary; thirty_day: SpendSummary }
  conversations: ConversationItem[]
  emails: EmailItem[]
  chat_messages: unknown[]
  tasks: Task[]
  channel_configs: ChannelConfig[]
  scheduled_tasks: ScheduledTask[]
  approvals_by_message: Record<string, { id: number; tool_name: string; tool_input: Record<string, unknown>; status: string; created_at: string }[]>
  installed_skills: SkillItem[]
  available_skills: SkillItem[]
  knowledge_documents: KnowledgeDocument[]
}

type Section = "chat" | "inbox" | "tasks" | "schedule" | "skills" | "knowledge" | "identity" | "spend"

const channelIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: Phone,
  telegram: Send,
  sms: Phone,
  web: MessageSquare,
  slack: Hash,
}

// ── Header bar content for this page ──
function agentStatusDot(status: string): "online" | "working" | "idle" | "error" | "offline" {
  if (status === "running" || status === "starting") return "working"
  if (status === "paused") return "offline"
  if (status === "stopped") return "error"
  return "idle"
}

function AgentTopBarMeta({ agent }: { agent: Agent }) {
  return (
    <div className="flex items-center gap-3 border-l pl-3">
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <StatusDot status={agentStatusDot(agent.status)} pulse={agent.status === "running"} />
        <span className="uppercase tracking-[0.1em]">{agent.status}</span>
      </span>
      {agent.ai_config && (
        <span className="hidden rounded-sm bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          {agent.ai_config.model_id}
        </span>
      )}
    </div>
  )
}

function AgentTopBarActions({ agent }: { agent: Agent }) {
  return (
    <div className="flex items-center gap-1.5">
      <AgentModelPicker
        agentId={agent.id}
        currentProvider={agent.ai_config?.provider}
        currentModelId={agent.ai_config?.model_id}
      />
      <AgentOpsMenu agentId={agent.id} />
      <Button variant="ghost" size="sm" className="h-8 gap-1.5" asChild>
        <Link href={agentChannelConfigsPath(agent.id)}>
          <Radio className="size-3.5" />
          Channels
        </Link>
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
        <Link href={editAgentPath(agent.id)}>
          <Settings className="size-3.5" />
          Edit
        </Link>
      </Button>
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

export default function AgentShow({ agent, spend, conversations, emails, chat_messages, tasks, scheduled_tasks, approvals_by_message, installed_skills = [], available_skills = [], knowledge_documents = [] }: Props) {
  const VALID_SECTIONS: Section[] = ["chat", "inbox", "tasks", "schedule", "skills", "knowledge", "identity", "spend"]
  const initialSection: Section = (() => {
    if (typeof window === "undefined") return "chat"
    const t = new URLSearchParams(window.location.search).get("tab") as Section | null
    return t && VALID_SECTIONS.includes(t) ? t : "chat"
  })()
  const [section, setSectionState] = useState<Section>(initialSection)

  function setSection(next: Section) {
    setSectionState(next)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (next === "chat") url.searchParams.delete("tab"); else url.searchParams.set("tab", next)
    window.history.replaceState({}, "", url.toString())
  }

  // Browser back/forward should sync the tab too.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onPop = () => {
      const t = new URLSearchParams(window.location.search).get("tab") as Section | null
      setSectionState(t && VALID_SECTIONS.includes(t) ? t : "chat")
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
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
    { key: "knowledge", label: "Knowledge", icon: BookOpen, count: knowledge_documents.length },
    { key: "identity", label: "Identity", icon: User },
    { key: "spend", label: "Spend", icon: DollarSign },
  ]

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: dashboardPath() },
        { label: "Agents", href: agentsPath() },
        { label: agent.name },
      ]}
      topBarMeta={<AgentTopBarMeta agent={agent} />}
      topBarActions={<AgentTopBarActions agent={agent} />}
    >
      <Head title={agent.name} />

      {/* ═══ Tabs ═══ */}
      <div className="-mx-4 -mt-4 flex items-center gap-0 overflow-x-auto border-b border-border px-4 sm:-mx-5 sm:px-5 md:-mx-6 md:-mt-6 md:px-6">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = section === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setSection(tab.key); setSelectedConvId(null); setSelectedEmailId(null) }}
              className={`relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors sm:px-4 ${
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
            <AgentChat agentId={agent.id} agentName={agent.name} agentStatus={agent.status} initialMessages={chat_messages as any} approvalsByMessage={approvals_by_message} />
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
          <TasksSection agentId={agent.id} agentName={agent.name} initialTasks={tasks} />
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

        {/* Knowledge */}
        {section === "knowledge" && (
          <div className="flex-1 overflow-hidden">
            <KnowledgePanel agentId={agent.id} agentName={agent.name} documents={knowledge_documents} />
          </div>
        )}

        {/* Identity */}
        {section === "identity" && (
          <IdentityEditor agent={agent} />
        )}

        {section === "spend" && (
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-2xl">
              {spend ? (
                <AgentSpendCard spend={spend} />
              ) : (
                <p className="text-muted-foreground text-sm">No spend data available yet.</p>
              )}
              <p className="text-muted-foreground mt-3 text-xs">
                Aggregated from audit_logs. Costs are computed from Anthropic's published per-model rates at the time each run completed.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

/* ═════════════════════════════════════════════════════════════
   Tasks panel — per-agent task list + creation + detail
   ═════════════════════════════════════════════════════════════ */

const TASK_STATUS_META: Record<string, { dot: string; label: string; fg: string }> = {
  todo:        { dot: "bg-muted-foreground/40",         label: "To do",       fg: "text-muted-foreground" },
  in_progress: { dot: "bg-[var(--color-indigo)]",       label: "In progress", fg: "text-[var(--color-indigo)]" },
  done:        { dot: "bg-[var(--color-success)]",      label: "Done",        fg: "text-[var(--color-success)]" },
  failed:      { dot: "bg-[var(--destructive)]",        label: "Failed",      fg: "text-[var(--destructive)]" },
}

const TASK_PRIORITY_META: Record<string, { label: string; className: string }> = {
  urgent: { label: "URGENT", className: "bg-[var(--destructive)]/10 text-[var(--destructive)] border-[var(--destructive)]/30" },
  high:   { label: "HIGH",   className: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  normal: { label: "NORMAL", className: "bg-[var(--muted)] text-muted-foreground border-[var(--border)]" },
  low:    { label: "LOW",    className: "bg-[var(--muted)] text-muted-foreground/60 border-[var(--border)]" },
}

function TasksSection({ agentId, agentName, initialTasks }: { agentId: string | number; agentName: string; initialTasks: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [creating, setCreating] = useState(false)
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [filter, setFilter] = useState<"all" | "todo" | "in_progress" | "done" | "failed">("all")

  const [title, setTitle] = useState("")
  const [instruction, setInstruction] = useState("")
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal")
  const [due, setDue] = useState("")
  const [posting, setPosting] = useState(false)

  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""

  const counts = {
    all: tasks.length,
    todo: tasks.filter((t) => t.status === "todo").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  }

  const visible = filter === "all" ? tasks : tasks.filter((t) => t.status === filter)

  async function handleCreate() {
    if (!title.trim()) return
    setPosting(true)
    const res = await fetch(`/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        task: {
          agent_id: agentId,
          title,
          instruction,
          priority,
          due_at: due || null,
        },
      }),
    })
    if (res.ok) {
      const created = await res.json()
      setTasks((prev) => [created, ...prev])
      setTitle("")
      setInstruction("")
      setPriority("normal")
      setDue("")
      setCreating(false)
    }
    setPosting(false)
  }

  async function handleStatus(taskId: string, status: string) {
    await fetch(`/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ task: { status } }),
    })
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: status as Task["status"] } : t)),
    )
  }

  async function handleDelete(taskId: string) {
    await fetch(`/tasks/${taskId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    })
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="font-display text-sm font-semibold tracking-[-0.01em]">
              Tasks for {agentName}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {counts.todo} to do · {counts.in_progress} running · {counts.done} done
            </div>
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 font-semibold"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? <XIcon className="size-3.5" /> : <Plus className="size-3.5" strokeWidth={2.5} />}
          {creating ? "Cancel" : "New task"}
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="border-b bg-[var(--muted)]/30 px-6 py-4">
          <div className="space-y-3 max-w-2xl">
            <div className="space-y-1.5">
              <Label htmlFor="task-title" className="text-xs">Title</Label>
              <Input
                id="task-title"
                placeholder="Research top 10 healthcare AI competitors"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-instruction" className="text-xs">Instruction</Label>
              <textarea
                id="task-instruction"
                rows={3}
                placeholder="Step-by-step what the agent should do…"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <SelectUI value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                  <SelectUITrigger className="w-full">
                    <SelectUIValue />
                  </SelectUITrigger>
                  <SelectUIContent>
                    <SelectUIItem value="low">Low</SelectUIItem>
                    <SelectUIItem value="normal">Normal</SelectUIItem>
                    <SelectUIItem value="high">High</SelectUIItem>
                    <SelectUIItem value="urgent">Urgent</SelectUIItem>
                  </SelectUIContent>
                </SelectUI>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due" className="text-xs">Due date</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={posting || !title.trim()}>
                {posting ? "Creating…" : "Create task"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-1 border-b px-6 py-2">
          {([
            { key: "all", label: "All" },
            { key: "todo", label: "To do" },
            { key: "in_progress", label: "Running" },
            { key: "done", label: "Done" },
            { key: "failed", label: "Failed" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === t.key
                  ? "bg-[var(--indigo-surface)] text-[var(--color-indigo)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span
                className={`rounded-sm px-1 font-mono text-[10px] ${
                  filter === t.key ? "bg-[var(--color-indigo)]/15" : "bg-[var(--muted)]"
                }`}
              >
                {counts[t.key as keyof typeof counts]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Task list */}
      <div className="px-6 py-4">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-md border border-dashed">
              <CheckSquare className="size-5 text-muted-foreground" />
            </div>
            <p className="font-display text-sm font-semibold">
              {filter === "all" ? `No tasks for ${agentName} yet` : `No ${filter.replace("_", " ")} tasks`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Assign a task and the agent will start working on it.
            </p>
            {!creating && (
              <Button size="sm" className="mt-5 gap-1.5" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                New task
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((task) => {
              const st = TASK_STATUS_META[task.status] ?? TASK_STATUS_META.todo
              const pri = TASK_PRIORITY_META[task.priority] ?? TASK_PRIORITY_META.normal
              const fullTask = task as Task & { instruction?: string | null; description?: string | null; result?: string | null; comments_count?: number }

              return (
                <button
                  type="button"
                  key={task.id}
                  onClick={() => setOpenTask(task)}
                  className="flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)]"
                >
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${st.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold tracking-[-0.005em] text-foreground">
                        {task.title}
                      </span>
                      <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${pri.className}`}>
                        {pri.label}
                      </span>
                    </div>
                    {fullTask.description && (
                      <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">
                        {fullTask.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      <span className={st.fg}>{st.label}</span>
                      {task.due_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          Due {new Date(task.due_at).toLocaleDateString()}
                        </span>
                      )}
                      {task.completed_at && (
                        <span className="text-[var(--color-success)]">
                          ✓ {new Date(task.completed_at).toLocaleDateString()}
                        </span>
                      )}
                      {(fullTask.comments_count ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="size-3" />
                          {fullTask.comments_count}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Task detail dialog */}
      <Dialog open={!!openTask} onOpenChange={(o) => !o && setOpenTask(null)}>
        <DialogContent className="max-w-2xl">
          {openTask && (() => {
            const task = openTask
            const st = TASK_STATUS_META[task.status] ?? TASK_STATUS_META.todo
            const pri = TASK_PRIORITY_META[task.priority] ?? TASK_PRIORITY_META.normal
            const t = task as Task & { instruction?: string | null; description?: string | null; result?: string | null }
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${st.dot}`} />
                    <span className={`font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${st.fg}`}>
                      {st.label}
                    </span>
                    <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${pri.className}`}>
                      {pri.label}
                    </span>
                  </div>
                  <DialogTitle className="mt-2 font-display text-xl font-semibold tracking-[-0.015em]">
                    {task.title}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {task.due_at && <span>Due {new Date(task.due_at).toLocaleDateString()}</span>}
                    {task.completed_at && (
                      <span className="text-[var(--color-success)]">
                        Completed {new Date(task.completed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {t.description && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Description
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                        {t.description}
                      </p>
                    </div>
                  )}
                  {t.instruction && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Instruction
                      </div>
                      <div className="rounded-md border bg-[var(--muted)]/50 p-3">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                          {t.instruction}
                        </p>
                      </div>
                    </div>
                  )}
                  {t.result && (
                    <div>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Result
                      </div>
                      <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success)]/[0.06] p-3">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                          {t.result}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="flex items-center gap-2">
                      {task.status !== "in_progress" && task.status !== "done" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            handleStatus(task.id, "in_progress")
                            setOpenTask({ ...task, status: "in_progress" })
                          }}
                        >
                          Start
                        </Button>
                      )}
                      {task.status !== "done" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            handleStatus(task.id, "done")
                            setOpenTask({ ...task, status: "done" })
                          }}
                        >
                          Mark done
                        </Button>
                      )}
                      {task.status === "done" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            handleStatus(task.id, "todo")
                            setOpenTask({ ...task, status: "todo" })
                          }}
                        >
                          Reopen
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Full view <ArrowUpRight className="size-3" />
                      </Link>
                      <button
                        onClick={() => {
                          handleDelete(task.id)
                          setOpenTask(null)
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-[var(--destructive)]"
                      >
                        <Trash2 className="size-3" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════
   Schedule panel
   ═════════════════════════════════════════════════════════════ */

/** Render a cron expression in plain English, falling back to raw. */
function describeCron(expr: string | null | undefined): string {
  if (!expr) return "—"
  const map: Record<string, string> = {
    "* * * * *":      "Every minute",
    "0 * * * *":      "Every hour (on the hour)",
    "0 9 * * *":      "Daily at 9:00",
    "0 9 * * 1-5":    "Weekdays at 9:00",
    "0 9 * * 1":      "Mondays at 9:00",
    "0 */6 * * *":    "Every 6 hours",
    "0 9 1 * *":      "1st of each month at 9:00",
  }
  return map[expr] ?? expr
}

function ScheduleSection({ agentId, initialTasks }: { agentId: number; initialTasks: ScheduledTask[] }) {
  const [tasks, setTasks] = useState(initialTasks)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [runsFor, setRunsFor] = useState<ScheduledTask | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const cronRef = useRef<HTMLInputElement>(null)
  const instructionRef = useRef<HTMLTextAreaElement>(null)
  const [timezone, setTimezone] = useState("UTC")
  const [tzOpen, setTzOpen] = useState(false)
  const [deliveryChannel, setDeliveryChannel] = useState<string>("web")

  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }

  function buildInstruction(raw: string): string {
    // Silent mode is enforced via the existing [SILENT] engine gate. Strip any
    // user-typed [SILENT] first so we don't double-prefix.
    const clean = raw.replace(/^\[SILENT\]\s*/i, "").trim()
    return deliveryChannel === "silent" ? `[SILENT] ${clean}` : clean
  }

  async function handleCreate() {
    const body = {
      scheduled_task: {
        name: nameRef.current?.value || "",
        cron_expression: cronRef.current?.value || "",
        instruction: buildInstruction(instructionRef.current?.value || ""),
        timezone: timezone,
        active: true,
        payload_extra: { channel: deliveryChannel === "silent" ? "web" : deliveryChannel },
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
        instruction: buildInstruction(instructionRef.current?.value || ""),
        timezone: timezone,
        payload_extra: { channel: deliveryChannel === "silent" ? "web" : deliveryChannel },
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

  const activeCount = tasks.filter((t) => t.active).length
  const totalCount = tasks.length

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div>
          <div className="font-display text-sm font-semibold tracking-[-0.01em]">Schedule</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {totalCount} schedule{totalCount === 1 ? "" : "s"} · {activeCount} active
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 font-semibold"
          onClick={() => { setShowForm(!showForm); setEditId(null) }}
        >
          {showForm ? <XIcon className="size-3.5" /> : <Plus className="size-3.5" strokeWidth={2.5} />}
          {showForm ? "Cancel" : "New schedule"}
        </Button>
      </div>

      <div className="px-6 py-4">

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

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Deliver results to</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "web",      label: "Web chat"  },
                { value: "telegram", label: "Telegram"  },
                { value: "whatsapp", label: "WhatsApp"  },
                { value: "email",    label: "Email"     },
                { value: "silent",   label: "Silent (audit only)" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDeliveryChannel(opt.value)}
                  className={`px-2.5 py-1 rounded border text-[11px] transition-colors ${
                    deliveryChannel === opt.value
                      ? "bg-foreground text-background border-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Final response is delivered here. "Silent" runs the task but only records the output in audit logs.
            </p>
          </div>

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
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-md border border-dashed">
            <Clock className="size-5 text-muted-foreground" />
          </div>
          <p className="font-display text-sm font-semibold">No schedules yet</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Create a recurring task — the agent will wake up and run it automatically.
          </p>
          <Button size="sm" className="mt-5 gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="size-3.5" />
            New schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((st) => {
            const scheduleSummary =
              st.mode === "once" && st.fire_at
                ? `Once · ${new Date(st.fire_at).toLocaleString()}`
                : st.mode === "interval" && st.interval_seconds
                  ? `Every ${st.interval_seconds >= 3600 ? `${Math.round(st.interval_seconds / 3600)} hours` : `${Math.round(st.interval_seconds / 60)} minutes`}`
                  : describeCron(st.cron_expression)
            const channelLabel = (() => {
              const isSilent = (st.instruction || "").trim().startsWith("[SILENT]")
              if (isSilent) return "silent"
              const ch = (st as any).delivery_channel as string | undefined
              return ch || "web"
            })()
            const runs = st.recent_runs ?? []

            return (
              <div
                key={st.id}
                className="overflow-hidden rounded-lg border bg-card transition-colors hover:border-[var(--border-strong)]"
              >
                {/* Primary row */}
                <div className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-1.5 flex size-2 shrink-0 items-center justify-center rounded-full ${
                      st.active ? "bg-[var(--color-success)]" : "bg-muted-foreground/40"
                    }`}
                  >
                    {st.active && (
                      <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[var(--color-success)] opacity-50" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold tracking-[-0.005em] text-foreground">
                        {st.name}
                      </span>
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${
                          st.active
                            ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                            : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {st.active ? "ACTIVE" : "PAUSED"}
                      </span>
                      {st.mode && st.mode !== "cron" && (
                        <span className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {st.mode === "once" ? "ONE-TIME" : "INTERVAL"}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-foreground">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3 text-muted-foreground" />
                        {scheduleSummary}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {st.timezone || "UTC"}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-indigo)]">
                        → {channelLabel}
                      </span>
                    </div>

                    {st.instruction && (
                      <p className="mt-1.5 line-clamp-1 text-[12px] text-muted-foreground">
                        {st.instruction.replace(/^\[SILENT\]\s*/i, "")}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {st.last_run_at ? (
                        <span>Last run · {new Date(st.last_run_at).toLocaleString()}</span>
                      ) : (
                        <span className="opacity-60">Never run</span>
                      )}
                      {runs.length > 0 && (
                        <span className="flex items-center gap-1">
                          <span className="flex items-center gap-0.5">
                            {runs.slice(0, 8).map((r) => (
                              <span
                                key={r.id}
                                title={`${r.status} · ${new Date(r.created_at).toLocaleString()}`}
                                className={`size-1.5 rounded-sm ${
                                  r.status === "success"
                                    ? "bg-[var(--color-success)]"
                                    : "bg-[var(--destructive)]"
                                }`}
                              />
                            ))}
                          </span>
                          {runs.length} run{runs.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggle(st.id, st.active)}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title={st.active ? "Pause" : "Resume"}
                    >
                      {st.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                    </button>
                    <button
                      onClick={() => {
                        setEditId(st.id)
                        const isSilent = (st.instruction || "").trim().startsWith("[SILENT]")
                        const storedChannel = (st as any).delivery_channel as string | null | undefined
                        setDeliveryChannel(isSilent ? "silent" : (storedChannel || "web"))
                      }}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Edit"
                    >
                      <PenLine className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(st.id)}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Runs — button opens a modal */}
                {runs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRunsFor(st)}
                    className="flex w-full items-center justify-between border-t bg-[var(--muted)]/30 px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-[var(--muted)]/60 hover:text-foreground"
                  >
                    <span>View recent runs · {runs.length}</span>
                    <ArrowUpRight className="size-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>

      {/* Runs dialog — master-detail split */}
      <Dialog open={!!runsFor} onOpenChange={(o) => !o && setRunsFor(null)}>
        <DialogContent className="!w-[min(1200px,95vw)] !max-w-[min(1200px,95vw)] gap-0 !p-0">
          {runsFor && <RunsDialogBody schedule={runsFor} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* Master-detail view rendered inside the runs dialog. */
function RunsDialogBody({ schedule }: { schedule: ScheduledTask }) {
  const runs = schedule.recent_runs ?? []
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.id ?? null)
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null

  const successCount = runs.filter((r) => r.status === "success").length
  const failCount = runs.length - successCount

  return (
    <div className="flex h-[70vh] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Runs · {runs.length}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-success)]">
              ✓ {successCount}
            </span>
            {failCount > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--destructive)]">
                ✗ {failCount}
              </span>
            )}
          </div>
          <h2 className="mt-1 truncate font-display text-lg font-semibold tracking-[-0.015em]">
            {schedule.name}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {describeCron(schedule.cron_expression)} · {schedule.timezone || "UTC"}
          </p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted-foreground">
          No runs yet
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12 md:divide-x">
          {/* Run list */}
          <div className="min-h-0 max-h-40 overflow-y-auto border-b md:col-span-4 md:max-h-none md:border-b-0">
            {runs.map((run) => {
              const isSelected = run.id === selected?.id
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  className={`flex w-full flex-col items-start gap-1 border-b px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? "bg-[var(--indigo-surface)]"
                      : "hover:bg-[var(--muted)]/50"
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full ${
                        run.status === "success"
                          ? "bg-[var(--color-success)]"
                          : "bg-[var(--destructive)]"
                      }`}
                    />
                    <span
                      className={`font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${
                        run.status === "success"
                          ? "text-[var(--color-success)]"
                          : "text-[var(--destructive)]"
                      }`}
                    >
                      {run.status}
                    </span>
                    {run.duration_ms !== null && run.duration_ms !== undefined && (
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {(run.duration_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-foreground">
                    {new Date(run.created_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {Array.isArray(run.tool_calls) && run.tool_calls.length > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {run.tool_calls.length} tool call{run.tool_calls.length === 1 ? "" : "s"}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Run detail */}
          <div className="min-h-0 overflow-y-auto md:col-span-8">
            {selected ? (
              <RunDetail run={selected} />
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-sm text-muted-foreground">
                Select a run
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const runMdComponents = {
  p: (p: any) => <p {...p} className="my-2 text-[13px] leading-relaxed text-foreground" />,
  h1: (p: any) => <h1 {...p} className="mt-3 mb-1 font-display text-base font-semibold" />,
  h2: (p: any) => <h2 {...p} className="mt-3 mb-1 font-display text-[15px] font-semibold" />,
  h3: (p: any) => <h3 {...p} className="mt-3 mb-1 font-display text-sm font-semibold" />,
  ul: (p: any) => <ul {...p} className="my-2 ml-5 list-disc space-y-1 text-[13px] leading-relaxed" />,
  ol: (p: any) => <ol {...p} className="my-2 ml-5 list-decimal space-y-1 text-[13px] leading-relaxed" />,
  li: (p: any) => <li {...p} className="pl-1" />,
  a: (p: any) => (
    <a
      {...p}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-[var(--color-indigo)] underline-offset-2 hover:underline"
    />
  ),
  code: ({ inline, ...p }: any) =>
    inline ? (
      <code {...p} className="rounded bg-[var(--muted)] px-1 py-0.5 font-mono text-[11px]" />
    ) : (
      <code {...p} className="block rounded bg-[var(--muted)] p-2 font-mono text-[11px] overflow-x-auto" />
    ),
  pre: (p: any) => (
    <pre
      {...p}
      className="my-2 overflow-x-auto rounded border bg-background p-2.5 font-mono text-[11px] leading-relaxed"
    />
  ),
  blockquote: (p: any) => (
    <blockquote
      {...p}
      className="my-2 border-l-2 border-[var(--color-indigo)]/40 pl-3 text-[13px] italic text-muted-foreground"
    />
  ),
  hr: (p: any) => <hr {...p} className="my-3 border-border" />,
  strong: (p: any) => <strong {...p} className="font-semibold text-foreground" />,
  em: (p: any) => <em {...p} className="italic" />,
  table: (p: any) => (
    <div className="my-2 overflow-x-auto">
      <table {...p} className="w-full border-collapse text-[12px]" />
    </div>
  ),
  th: (p: any) => (
    <th
      {...p}
      className="border-b bg-[var(--muted)]/60 px-2 py-1 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
    />
  ),
  td: (p: any) => <td {...p} className="border-b px-2 py-1" />,
}

function RunMarkdown({ children }: { children: string }) {
  return (
    <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={runMdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

function RunDetail({ run }: { run: ScheduledTaskRun }) {
  // Dedupe tool calls with count
  const toolCalls: { name: string; count: number }[] = (() => {
    const arr = Array.isArray(run.tool_calls) ? (run.tool_calls as { name: string }[]) : []
    const map = new Map<string, number>()
    for (const tc of arr) {
      map.set(tc.name, (map.get(tc.name) ?? 0) + 1)
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
  })()

  return (
    <div className="space-y-5 p-5">
      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${
            run.status === "success"
              ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]"
              : "border-[var(--destructive)]/30 bg-[var(--destructive)]/10 text-[var(--destructive)]"
          }`}
        >
          {run.status}
        </span>
        <span className="font-mono text-[11px] text-foreground">
          {new Date(run.created_at).toLocaleString()}
        </span>
        {run.duration_ms !== null && run.duration_ms !== undefined && (
          <span className="font-mono text-[11px] text-muted-foreground">
            · {(run.duration_ms / 1000).toFixed(2)}s
          </span>
        )}
      </div>

      {/* Output */}
      {run.output ? (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Output
          </div>
          <div className="rounded-md border bg-[var(--muted)]/50 px-4 py-3">
            <RunMarkdown>{run.output}</RunMarkdown>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed py-6 text-center font-mono text-[11px] text-muted-foreground">
          No output
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Tool calls · {toolCalls.reduce((n, t) => n + t.count, 0)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {toolCalls.map((tc) => (
              <span
                key={tc.name}
                className="inline-flex items-center gap-1 rounded-sm border bg-card px-2 py-0.5 font-mono text-[10px] text-foreground"
              >
                {tc.name}
                {tc.count > 1 && (
                  <span className="rounded-sm bg-[var(--indigo-surface)] px-1 text-[var(--color-indigo)]">
                    ×{tc.count}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
