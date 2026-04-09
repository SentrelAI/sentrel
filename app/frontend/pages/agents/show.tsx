import { Head, Link } from "@inertiajs/react"
import { ArrowLeft, Bot, MessageSquare, CheckSquare, Clock, Settings, Send } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { AgentChat } from "@/components/agent-chat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { agentsPath, editAgentPath, agentConversationsPath, agentChannelConfigsPath } from "@/routes"
import type { Agent, Conversation, Task, ChannelConfig, ScheduledTask } from "@/types"

const statusColor: Record<string, string> = {
  running: "bg-green-500",
  pending: "bg-yellow-500",
  paused: "bg-gray-400",
  stopped: "bg-red-500",
  starting: "bg-blue-500",
}

interface Props {
  agent: Agent
  conversations: Conversation[]
  chat_messages: unknown[]
  tasks: Task[]
  channel_configs: ChannelConfig[]
  scheduled_tasks: ScheduledTask[]
  approvals_by_message: Record<string, { id: number; tool_name: string; tool_input: Record<string, unknown>; status: string; created_at: string }[]>
}

export default function AgentShow({ agent, conversations, chat_messages, tasks, channel_configs, scheduled_tasks, approvals_by_message }: Props) {
  return (
    <AppLayout>
      <Head title={agent.name} />

      <div className="mb-6">
        <Link href={agentsPath()} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="size-3.5 mr-1" />
          Back to Agents
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
              <Bot className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">{agent.name}</h1>
                <div className="flex items-center gap-1.5">
                  <div className={`size-2 rounded-full ${statusColor[agent.status] || "bg-gray-400"}`} />
                  <span className="text-xs text-muted-foreground capitalize">{agent.status}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="secondary" className="text-[10px]">{agent.role}</Badge>
                {agent.ai_config && (
                  <span className="text-[10px] text-muted-foreground font-mono">{agent.ai_config.model_id}</span>
                )}
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
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">
            <Send className="size-3.5 mr-1.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="conversations">
            <MessageSquare className="size-3.5 mr-1.5" />
            Inbox ({conversations.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <CheckSquare className="size-3.5 mr-1.5" />
            Tasks ({tasks.length})
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Clock className="size-3.5 mr-1.5" />
            Schedule ({scheduled_tasks.length})
          </TabsTrigger>
          <TabsTrigger value="identity">
            <Bot className="size-3.5 mr-1.5" />
            Identity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-4">
          <AgentChat agentId={agent.id} agentName={agent.name} initialMessages={chat_messages as any} approvalsByMessage={approvals_by_message} />
        </TabsContent>

        <TabsContent value="conversations" className="mt-4">
          {conversations.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border">
              {conversations.map((conv) => (
                <Link key={conv.id} href={agentConversationsPath(agent.id) + `/${conv.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className="font-medium text-sm">{conv.contact_name || conv.contact_email || "Unknown"}</span>
                    <Badge variant={conv.kind === "internal" ? "default" : "secondary"} className="text-[10px]">
                      {conv.kind}
                    </Badge>
                    {conv.subject && <span className="text-xs text-muted-foreground">{conv.subject}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(conv.updated_at).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          {tasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No tasks assigned
            </div>
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
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
          {scheduled_tasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No scheduled tasks
            </div>
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
        </TabsContent>

        <TabsContent value="identity" className="mt-4">
          <div className="grid gap-3 md:grid-cols-2">
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
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
