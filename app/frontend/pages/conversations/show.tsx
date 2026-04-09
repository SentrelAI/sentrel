import { Head, Link } from "@inertiajs/react"
import { ArrowLeft, Mail, Phone, Send, MessageSquare, ArrowUpRight, ArrowDownLeft } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { agentPath } from "@/routes"

interface Message {
  id: number
  role: "user" | "assistant" | "system"
  content: string
  direction: string | null
  channel: string | null
  metadata: Record<string, unknown>
  created_at: string
}

interface Props {
  agent: { id: number; name: string; slug: string; role: string }
  conversation: {
    id: number
    kind: string
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    subject: string | null
    status: string
  }
  messages: Message[]
}

const channelIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: Phone,
  telegram: Send,
  web: MessageSquare,
  sms: Phone,
}

export default function ConversationShow({ agent, conversation, messages }: Props) {
  const contact = conversation.contact_name || conversation.contact_email || conversation.contact_phone || "Unknown"
  const channel = messages[0]?.channel || "web"
  const ChannelIcon = channelIcon[channel] || MessageSquare

  return (
    <AppLayout>
      <Head title={`${contact} — ${agent.name}`} />

      <div className="mb-4">
        <Link href={agentPath(agent.id)} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="size-3.5 mr-1" />
          Back to {agent.name}
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <ChannelIcon className="size-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{contact}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {conversation.subject && (
                <span className="text-xs text-muted-foreground">{conversation.subject}</span>
              )}
              <Badge variant="secondary" className="text-[10px]">{channel}</Badge>
              <span className="text-[10px] text-muted-foreground">{messages.length} messages</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl space-y-1">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} agentName={agent.name} contact={contact} channel={channel} />
        ))}

        {messages.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No messages in this conversation
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function MessageBubble({ message, agentName, contact, channel }: { message: Message; agentName: string; contact: string; channel: string }) {
  const isOutbound = message.direction === "outbound" || message.role === "assistant"
  const sender = isOutbound ? agentName : contact
  const DirectionIcon = isOutbound ? ArrowUpRight : ArrowDownLeft

  // Email-specific metadata
  const emailMeta = message.metadata as { to?: string; cc?: string[]; subject?: string }

  return (
    <div className={`rounded-lg border p-4 ${isOutbound ? "bg-card" : "bg-muted/30"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <DirectionIcon className={`size-3.5 ${isOutbound ? "text-blue-500" : "text-green-500"}`} />
          <span className="font-medium text-sm">{sender}</span>
          {channel === "email" && emailMeta.to && (
            <span className="text-xs text-muted-foreground">to {isOutbound ? emailMeta.to : agentName}</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {new Date(message.created_at).toLocaleString()}
        </span>
      </div>

      {channel === "email" && emailMeta.subject && (
        <p className="text-sm font-medium mb-2">{emailMeta.subject}</p>
      )}

      {channel === "email" && emailMeta.cc && emailMeta.cc.length > 0 && (
        <p className="text-xs text-muted-foreground mb-2">CC: {emailMeta.cc.join(", ")}</p>
      )}

      <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {message.content}
      </div>
    </div>
  )
}
