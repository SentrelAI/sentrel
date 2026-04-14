import { Head, router } from "@inertiajs/react"
import { Plug, Trash2, Check } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const AVAILABLE_INTEGRATIONS = [
  { name: "apollo", label: "Apollo", description: "CRM and lead generation", category: "Sales" },
  { name: "hubspot", label: "HubSpot", description: "CRM, marketing, and sales", category: "Sales" },
  { name: "linkedin", label: "LinkedIn", description: "Professional network and outreach", category: "Sales" },
  { name: "gmail", label: "Gmail", description: "Email via Google", category: "Communication" },
  { name: "slack", label: "Slack", description: "Team messaging", category: "Communication" },
  { name: "intercom", label: "Intercom", description: "Customer support", category: "Communication" },
  { name: "googlecalendar", label: "Google Calendar", description: "Scheduling", category: "Productivity" },
  { name: "googlesheets", label: "Google Sheets", description: "Spreadsheets", category: "Productivity" },
  { name: "googledrive", label: "Google Drive", description: "Documents and files", category: "Productivity" },
  { name: "notion", label: "Notion", description: "Docs and wiki", category: "Productivity" },
  { name: "airtable", label: "Airtable", description: "Flexible database", category: "Productivity" },
  { name: "calendly", label: "Calendly", description: "Booking and scheduling", category: "Productivity" },
  { name: "github", label: "GitHub", description: "Code and PRs", category: "Engineering" },
  { name: "linear", label: "Linear", description: "Issue tracking", category: "Engineering" },
  { name: "vercel", label: "Vercel", description: "Frontend deployment", category: "Engineering" },
  { name: "stripe", label: "Stripe", description: "Payments and billing", category: "Finance" },
  { name: "twitter", label: "Twitter / X", description: "Social media", category: "Content" },
  { name: "figma", label: "Figma", description: "Design collaboration", category: "Content" },
  { name: "mailchimp", label: "Mailchimp", description: "Email marketing", category: "Content" },
  { name: "typeform", label: "Typeform", description: "Forms and surveys", category: "Content" },
  { name: "digital_ocean", label: "DigitalOcean", description: "Cloud infrastructure", category: "Engineering" },
]

interface Integration {
  id: number
  service_name: string
  status: string
  scopes: string[]
  created_at: string
}

export default function IntegrationsIndex({ integrations }: { integrations: Integration[] }) {
  async function connect(serviceName: string) {
    // Get the Composio OAuth URL from Rails, then open in a popup
    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    const res = await fetch(`/integrations/${serviceName}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-Token": csrfToken },
    })
    const data = await res.json()
    if (data.redirect_url) {
      const popup = window.open(data.redirect_url, "composio-connect", "width=600,height=700,left=200,top=100")
      // Poll for popup close, then refresh
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer)
          router.reload()
        }
      }, 500)
    } else if (data.error) {
      alert(data.error)
    }
  }

  function disconnect(id: number) {
    router.delete(`/integrations/${id}`)
  }

  const categories = [...new Set(AVAILABLE_INTEGRATIONS.map((i) => i.category))]

  return (
    <AppLayout>
      <Head title="Integrations" />

      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Connect your tools — agents use them to get work done</p>
      </div>

      <div className="space-y-8">
        {categories.map((category) => (
          <div key={category}>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{category}</h2>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {AVAILABLE_INTEGRATIONS.filter((i) => i.category === category).map((service) => {
                const connected = integrations.find((i) => i.service_name === service.name)
                return (
                  <div
                    key={service.name}
                    className={`flex items-center gap-3 rounded-lg border border-border px-3.5 py-3 transition-colors ${
                      connected ? "" : "opacity-60 hover:opacity-100"
                    }`}
                  >
                    <div className="flex size-8 items-center justify-center rounded-md bg-muted shrink-0">
                      <Plug className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{service.label}</p>
                      <p className="text-[11px] text-muted-foreground">{service.description}</p>
                    </div>
                    {connected ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="default" className="text-[10px] bg-emerald-600">
                          <Check className="size-2.5 mr-0.5" />
                          Connected
                        </Badge>
                        <button
                          onClick={() => disconnect(connected.id)}
                          className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => connect(service.name)}>
                        Connect
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}
