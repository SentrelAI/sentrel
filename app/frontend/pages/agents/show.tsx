import { Head, Link } from "@inertiajs/react"
import { ArrowLeft, Bot, MessageSquare, CheckSquare, Clock, Settings, Send } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { AgentChat } from "@/components/agent-chat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { agentsPath, editAgentPath, agentConversationsPath } from "@/routes"
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
}

export default function AgentShow({ agent, conversations, chat_messages, tasks, channel_configs, scheduled_tasks }: Props) {
  return (
    <AppLayout>
      <Head title={agent.name} />

      <div className="mb-8">
        <Link href={agentsPath()} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="size-4 mr-1" />
          Back to Agents
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Bot className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
                <div className="flex items-center gap-1.5">
                  <div className={`size-2.5 rounded-full ${statusColor[agent.status] || "bg-gray-400"}`} />
                  <span className="text-sm text-muted-foreground capitalize">{agent.status}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary">{agent.role}</Badge>
                {agent.ai_config && (
                  <span className="text-xs text-muted-foreground font-mono">{agent.ai_config.model_id}</span>
                )}
              </div>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href={editAgentPath(agent.id)}>
              <Settings className="size-4 mr-2" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">
            <Send className="size-4 mr-1.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="conversations">
            <MessageSquare className="size-4 mr-1.5" />
            Inbox ({conversations.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <CheckSquare className="size-4 mr-1.5" />
            Tasks ({tasks.length})
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Clock className="size-4 mr-1.5" />
            Schedule ({scheduled_tasks.length})
          </TabsTrigger>
          <TabsTrigger value="identity">
            <Bot className="size-4 mr-1.5" />
            Identity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-6">
          <AgentChat agentId={agent.id} agentName={agent.name} initialMessages={chat_messages as any} />
        </TabsContent>

        <TabsContent value="conversations" className="mt-6">
          {conversations.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No conversations yet
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => (
                <Link key={conv.id} href={agentConversationsPath(agent.id) + `/${conv.id}`}>
                  <Card className="hover:border-[#D4A843]/40 cursor-pointer">
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{conv.contact_name || conv.contact_email || "Unknown"}</span>
                          <Badge variant={conv.kind === "internal" ? "default" : "secondary"} className="text-xs">
                            {conv.kind}
                          </Badge>
                        </div>
                        {conv.subject && <p className="text-sm text-muted-foreground mt-0.5">{conv.subject}</p>}
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(conv.updated_at).toLocaleDateString()}</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-6">
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No tasks assigned
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <Card key={task.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <span className="font-medium">{task.title}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={task.status === "done" ? "default" : "secondary"}>{task.status}</Badge>
                        <Badge variant="outline">{task.priority}</Badge>
                      </div>
                    </div>
                    {task.due_at && (
                      <span className="text-xs text-muted-foreground">Due {new Date(task.due_at).toLocaleDateString()}</span>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="schedule" className="mt-6">
          {scheduled_tasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No scheduled tasks
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {scheduled_tasks.map((st) => (
                <Card key={st.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <span className="font-medium">{st.name}</span>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{st.cron_expression}</p>
                    </div>
                    <Badge variant={st.active ? "default" : "secondary"}>{st.active ? "Active" : "Paused"}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="identity" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Identity</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground">{agent.identity_md || "Not set"}</pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Personality</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground">{agent.personality_md || "Not set"}</pre>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-sm">Instructions</CardTitle></CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground">{agent.instructions_md || "Not set"}</pre>
              </CardContent>
            </Card>
            {agent.memory_md && (
              <Card className="md:col-span-2">
                <CardHeader><CardTitle className="text-sm">Memory</CardTitle></CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap text-muted-foreground">{agent.memory_md}</pre>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
