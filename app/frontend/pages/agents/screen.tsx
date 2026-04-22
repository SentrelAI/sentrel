import { Head, Link } from "@inertiajs/react"
import { ArrowLeft, Monitor, AlertCircle } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { agentPath, agentsPath } from "@/routes"

interface Props {
  agent: { id: string; name: string; slug: string; role: string }
  instance: null | {
    status: string
    provider: string
    public_ip: string | null
    machine_type: string | null
    health_checked_at: string | null
    vnc_url: string | null
  }
}

// Phase 3 — live screen view.
//
// When the provisioner is configured and the agent's machine is running, an
// iframe embeds noVNC pointing at the display-stack sidecar on the agent's
// VM. The user literally watches the agent's Camofox move its mouse and
// type.
//
// In dev (no provisioner) or when the machine is still spinning up, we
// render a friendly placeholder explaining the state.
export default function AgentScreen({ agent, instance }: Props) {
  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Agents", href: agentsPath() },
        { label: agent.name, href: agentPath(agent.id) },
        { label: "Screen" },
      ]}
    >
      <Head title={`${agent.name} — Screen`} />
      <PageHeader
        eyebrow={agent.role}
        title={`Watch ${agent.name} work`}
        description="Live view of the agent's browser. The agent doesn't know you're watching."
      />

      {!instance || !instance.vnc_url ? (
        <NotAvailable instance={instance} />
      ) : (
        <div className="rounded-lg border bg-black overflow-hidden" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            title={`${agent.name} screen`}
            // noVNC loads from the sidecar. The vnc.html entry point negotiates
            // the WebSocket itself. We pass the WS URL via hash so it auto-connects.
            src={`${instance.vnc_url.replace(/^ws/, "http")}/vnc.html?autoconnect=1&resize=scale&path=websockify`}
            className="w-full h-full"
          />
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={agentPath(agent.id)}>
            <ArrowLeft className="size-3.5 mr-1.5" />
            Back to {agent.name}
          </Link>
        </Button>
      </div>

      {instance && (
        <div className="mt-6 rounded-lg border bg-card p-4 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">Machine:</span> {instance.provider} · {instance.machine_type || "—"}
            </div>
            <div><span className="font-medium">Status:</span> {instance.status}</div>
          </div>
          {instance.public_ip && (
            <div className="mt-1"><span className="font-medium">IP:</span> <code className="font-mono">{instance.public_ip}</code></div>
          )}
        </div>
      )}
    </AppLayout>
  )
}

function NotAvailable({ instance }: { instance: Props["instance"] }) {
  const state =
    !instance                          ? "no_machine"     :
    instance.status === "provisioning" ? "provisioning"   :
    instance.status === "pending"      ? "pending"        :
    instance.status === "failed"       ? "failed"         :
                                         "no_vnc"

  const messages: Record<string, { title: string; body: string }> = {
    no_machine:    { title: "No machine yet",    body: "This agent doesn't have a dedicated machine assigned. Configure AGENT_PROVISIONER and re-create the agent, or run the engine locally to chat without a provisioned VM." },
    provisioning:  { title: "Machine starting…", body: "The agent's machine is still spinning up. Takes ~10s on Fly, ~60s on Hetzner. Refresh in a moment." },
    pending:       { title: "Machine queued",    body: "The provisioner hasn't created the machine yet. This usually resolves in a few seconds." },
    failed:        { title: "Provisioning failed", body: "The machine failed to come up. Check engine logs + provisioner credentials." },
    no_vnc:        { title: "Display not exposed", body: "The machine is running but the display-stack sidecar isn't exposing noVNC on this machine. Only agents deployed with the display-stack enabled support live viewing." },
  }
  const msg = messages[state]!

  return (
    <div className="rounded-lg border border-dashed bg-card p-8 flex flex-col items-center text-center">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
        {state === "failed" ? <AlertCircle className="size-5 text-red-500" /> : <Monitor className="size-5 text-muted-foreground" />}
      </div>
      <div className="text-sm font-medium mb-1">{msg.title}</div>
      <p className="text-xs text-muted-foreground max-w-md">{msg.body}</p>
    </div>
  )
}
