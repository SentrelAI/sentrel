import { Head } from "@inertiajs/react"

import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import FilesPanel, { type AgentFile } from "@/components/files-panel"
import { agentPath, agentsPath, dashboardPath } from "@/routes"

interface Props {
  agent: { id: string; name: string; slug: string }
  files: AgentFile[]
}

export default function FilesIndex({ agent, files }: Props) {
  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: dashboardPath() },
        { label: "Agents", href: agentsPath() },
        { label: agent.name, href: agentPath(agent.id) },
        { label: "Files" },
      ]}
    >
      <Head title={`Files — ${agent.name}`} />

      <PageHeader
        eyebrow="File finder"
        title={`${agent.name}'s files`}
        description="Whole files this agent can browse and read in full — no vectorization."
      />

      <FilesPanel agentId={agent.id} agentName={agent.name} files={files} />
    </AppLayout>
  )
}
