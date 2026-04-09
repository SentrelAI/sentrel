import { Head, Link, useForm } from "@inertiajs/react"
import { ArrowLeft } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { agentPath } from "@/routes"
import type { Agent } from "@/types"

export default function AgentEdit({ agent }: { agent: Agent }) {
  const { data, setData, patch, processing } = useForm({
    name: agent.name,
    slug: agent.slug,
    role: agent.role,
    identity_md: agent.identity_md || "",
    personality_md: agent.personality_md || "",
    instructions_md: agent.instructions_md || "",
    heartbeat_enabled: agent.heartbeat_enabled,
    heartbeat_interval_minutes: agent.heartbeat_interval_minutes,
    ai_config: {
      provider: agent.ai_config?.provider || "anthropic",
      model_id: agent.ai_config?.model_id || "claude-sonnet-4-20250514",
      temperature: agent.ai_config?.temperature || 0.7,
      max_tokens: agent.ai_config?.max_tokens || 8192,
      thinking_level: agent.ai_config?.thinking_level || "none",
    },
    permissions: (agent as any).permissions || {},
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    patch(agentPath(agent.id))
  }

  return (
    <AppLayout>
      <Head title={`Edit ${agent.name}`} />

      <div className="mb-8">
        <Link href={agentPath(agent.id)} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="size-4 mr-1" />
          Back to {agent.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Edit {agent.name}</h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={data.name} onChange={(e) => setData("name", e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" value={data.slug} onChange={(e) => setData("slug", e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input id="role" value={data.role} onChange={(e) => setData("role", e.target.value)} required />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identity_md">Identity</Label>
              <textarea
                id="identity_md"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={data.identity_md}
                onChange={(e) => setData("identity_md", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="personality_md">Personality</Label>
              <textarea
                id="personality_md"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={data.personality_md}
                onChange={(e) => setData("personality_md", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instructions_md">Instructions</Label>
              <textarea
                id="instructions_md"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={data.instructions_md}
                onChange={(e) => setData("instructions_md", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Heartbeat</CardTitle>
            <CardDescription>Proactive check-ins — agent periodically checks for things that need attention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="heartbeat_enabled"
                checked={data.heartbeat_enabled}
                onCheckedChange={(checked) => setData("heartbeat_enabled", !!checked)}
              />
              <Label htmlFor="heartbeat_enabled">Enable heartbeat</Label>
            </div>
            {data.heartbeat_enabled && (
              <div className="space-y-2">
                <Label htmlFor="heartbeat_interval">Check every (minutes)</Label>
                <Input
                  id="heartbeat_interval"
                  type="number"
                  min={5}
                  max={1440}
                  value={data.heartbeat_interval_minutes}
                  onChange={(e) => setData("heartbeat_interval_minutes", parseInt(e.target.value))}
                  className="w-32"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
            <CardDescription>Control what actions require approval</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Send Email</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Agent can compose and send emails</p>
              </div>
              <Select
                value={data.permissions?.send_email || "auto"}
                onValueChange={(v) => setData("permissions", { ...data.permissions, send_email: v })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (send immediately)</SelectItem>
                  <SelectItem value="draft">Draft (requires approval)</SelectItem>
                  <SelectItem value="never">Never (disabled)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end gap-3">
          <Button variant="outline" asChild>
            <Link href={agentPath(agent.id)}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={processing}>
            {processing ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </AppLayout>
  )
}
